-- Run once in a NEW Supabase project, after replacing the two SHA-256 hashes.
-- The actual guest/admin secrets must NEVER be committed to the repository.
begin;
create schema if not exists album70_private;
revoke all on schema album70_private from public, anon, authenticated;
create table album70_private.settings (
 id boolean primary key default true check(id),
 guest_hash text not null check(length(guest_hash)=64),
 admin_hash text not null check(length(admin_hash)=64),
 uploads_open boolean not null default true
);
insert into album70_private.settings(guest_hash,admin_hash)
 values ('REPLACE_GUEST_SHA256','REPLACE_ADMIN_SHA256');
create table album70_private.photos (
 id uuid primary key default gen_random_uuid(),
 path text unique not null, thumb_path text unique not null,
 display_name text not null,
 created_at timestamptz not null default now(),
 ready boolean not null default false, hidden boolean not null default false,
 charged_bytes bigint not null default 20000000 check(charged_bytes between 1 and 20000000)
);
alter table album70_private.settings enable row level security;
alter table album70_private.photos enable row level security;
-- Charge the full 10 MB limit for EACH of the two objects while an upload is
-- pending. The row lock in reserve serializes quota reservations. Failed
-- reservations stay charged; this intentionally fails closed until cleaned up.
create function public.album70_access(p_admin boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare h jsonb; c jsonb; a text; g text;
begin
 h:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 begin c:=coalesce(h->>'x-client-info','{}')::jsonb; exception when others then return false; end;
 a:=c->>'admin';g:=c->>'album';
 return exists(select 1 from album70_private.settings s where
   (length(a)>=32 and encode(sha256(convert_to(a,'UTF8')),'hex')=s.admin_hash)
   or (not p_admin and length(g)>=32 and encode(sha256(convert_to(g,'UTF8')),'hex')=s.guest_hash));
end $$;
create function public.album70_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.album70_access() then raise exception 'Odkaz na album není platný.';end if;
 return (select jsonb_build_object('uploads_open',s.uploads_open,'is_admin',public.album70_access(true),
 'photo_count',(select count(*) from album70_private.photos where ready and not hidden)) from album70_private.settings s);
end $$;
create function public.album70_list(p_offset integer default 0,p_hidden boolean default false)
returns table(id uuid,path text,thumb_path text,display_name text,created_at timestamptz,hidden boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.album70_access() then raise exception 'Odkaz na album není platný.';end if;
 return query select p.id,p.path,p.thumb_path,p.display_name,p.created_at,p.hidden from album70_private.photos p
 where p.ready and (not p.hidden or (p_hidden and public.album70_access(true)))
 order by p.created_at desc,p.id limit 40 offset greatest(0,p_offset);
end $$;
create function public.album70_reserve(p_name text,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); ext text; item album70_private.photos; opened boolean;
begin
 if not public.album70_access() then raise exception 'Odkaz na album není platný.';end if;
 select uploads_open into opened from album70_private.settings where id for update;
 if not opened then raise exception 'Nahrávání je pozastavené.';end if;
 if (select coalesce(sum(charged_bytes),0) from album70_private.photos)>880000000 then
 raise exception 'Album je plné. Ozvěte se prosím pořadateli.';end if;
 ext:=case p_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
 if ext is null then raise exception 'Nepodporovaný formát.';end if;
 insert into album70_private.photos(id,path,thumb_path,display_name)
 values(new_id,'original/'||new_id||'.'||ext,'thumb/'||new_id||'.jpg',left(coalesce(nullif(p_name,''),'Fotka'),160)) returning * into item;
 return jsonb_build_object('id',item.id,'path',item.path,'thumb_path',item.thumb_path);
end $$;
create function public.album70_finish(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item album70_private.photos; total_bytes bigint; objects_count integer;
begin
 if not public.album70_access() then raise exception 'Odkaz na album není platný.';end if;
 select * into item from album70_private.photos where id=p_id for update;
 if not found then raise exception 'Nahrávání neexistuje.';end if;
 select count(*),sum((metadata->>'size')::bigint) into objects_count,total_bytes
 from storage.objects where bucket_id='album70' and name in(item.path,item.thumb_path);
 if objects_count<>2 or total_bytes is null or total_bytes<1 or total_bytes>20000000 then
 raise exception 'Nahrávání není dokončené.';end if;
 update album70_private.photos set ready=true,charged_bytes=total_bytes where id=p_id;
end $$;
create function public.album70_object_allowed(p_path text,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select public.album70_access() and exists(select 1 from album70_private.photos p
 where p_path in(p.path,p.thumb_path) and
 case when p_write then not p.ready and p.created_at>now()-interval '1 hour'
 and (select uploads_open from album70_private.settings where id)
 else p.ready and (not p.hidden or public.album70_access(true)) end);
$$;
create function public.album70_hide(p_id uuid,p_hidden boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.album70_access(true) then raise exception 'Pouze správce může měnit album.';end if;
 update album70_private.photos set hidden=p_hidden where id=p_id;
end $$;
create function public.album70_open(p_open boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.album70_access(true) then raise exception 'Pouze správce může měnit album.';end if;
 update album70_private.settings set uploads_open=p_open where id;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('album70','album70',false,10000000,array['image/jpeg','image/png','image/webp']);
create policy "album70_read" on storage.objects for select to anon,authenticated
using(bucket_id='album70' and public.album70_object_allowed(name,false));
create policy "album70_upload_new" on storage.objects for insert to anon,authenticated
with check(bucket_id='album70' and public.album70_object_allowed(name,true));
-- Intentionally no UPDATE or DELETE policy. Guest uploads cannot overwrite or
-- delete existing objects. Management hides/restores photos through guarded RPCs.
revoke all on all tables in schema album70_private from public,anon,authenticated;
revoke all on function public.album70_access(boolean),public.album70_state(),public.album70_list(integer,boolean),
public.album70_reserve(text,text),public.album70_finish(uuid),public.album70_object_allowed(text,boolean),
public.album70_hide(uuid,boolean),public.album70_open(boolean) from public;
grant execute on function public.album70_access(boolean),public.album70_state(),public.album70_list(integer,boolean),
public.album70_reserve(text,text),public.album70_finish(uuid),public.album70_object_allowed(text,boolean),
public.album70_hide(uuid,boolean),public.album70_open(boolean) to anon,authenticated;
commit;
