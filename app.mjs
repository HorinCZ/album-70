const $=s=>document.querySelector(s);
const cfg=window.ALBUM_CONFIG||{};
const token=new URLSearchParams(location.hash.slice(1)).get('album')||'';
let admin='',state=null,photos=[],page=0,busy=false,activePhoto=null;
const urls=new Set();
function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error)}
function headers(extra={}){return {apikey:cfg.key,Authorization:'Bearer '+cfg.key,'x-client-info':JSON.stringify({album:token,admin}),...extra}}
async function request(path,options={}){
 const r=await fetch(cfg.url+path,{...options,headers:headers(options.headers)});
 if(!r.ok){let e;try{e=await r.json()}catch{}throw new Error(e?.message||e?.error||'Spojení s albem se nezdařilo. Zkuste to znovu.');}
 return r.status===204?null:r.json();
}
const rpc=(name,data={})=>request('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
async function blob(path){
 const signed=await request('/storage/v1/object/sign/album70/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
 const url=new URL('/storage/v1'+signed.signedURL,cfg.url);
 if(url.origin!==new URL(cfg.url).origin)throw new Error('Neplatný odkaz na fotku.');
 const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Fotku se nepodařilo načíst.');return r.blob();
}
function localURL(b){const u=URL.createObjectURL(b);urls.add(u);return u}
function releaseImages(){for(const u of urls)URL.revokeObjectURL(u);urls.clear()}
async function load(reset=true){
 if(!cfg.url||!cfg.key){status('Album ještě není spuštěné. Čeká na připojení úložiště.',true);return}
 if(!token){status('Otevřete prosím celý odkaz na album, který jste dostali od pořadatele.',true);return}
 try{
  state=await rpc('album70_state');$('#add').disabled=!state.uploads_open||busy;
  $('#admin-panel').hidden=!state.is_admin;$('#toggle-uploads').textContent=state.uploads_open?'Pozastavit nahrávání':'Povolit nahrávání';
  if(reset){if($('#viewer').open)$('#viewer').close();clearOriginals();page=0;photos=[];$('#grid').replaceChildren();releaseImages()}
  const rows=await rpc('album70_list',{p_offset:page*40,p_hidden:!!admin&&$('#show-hidden').checked});
  photos.push(...rows);for(const p of rows)render(p);page++;
  const n=state.photo_count;$('#count').textContent=n+' '+(n===1?'fotka':n>=2&&n<=4?'fotky':'fotek');$('#empty').hidden=photos.length>0;$('#more').hidden=rows.length<40;
  status(state.uploads_open?'':'Nahrávání je nyní pozastavené. Fotky si můžete dál prohlížet.');
 }catch(e){status('Album není dostupné. '+e.message,true);$('#add').disabled=true}
}
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);loadThumb(e.target)}},{rootMargin:'250px'});
async function loadThumb(img){try{img.src=localURL(await blob(img.dataset.path))}catch{img.alt='Náhled není dostupný — otevřete fotku'}}
function render(p){
 const card=document.createElement('article');card.className='photo';
 const button=document.createElement('button');button.className='image-button';button.setAttribute('aria-label','Otevřít fotku '+p.display_name);
 const img=document.createElement('img');img.alt=p.display_name;img.dataset.path=p.thumb_path||p.path;button.append(img);button.onclick=()=>openPhoto(p);
 const name=document.createElement('p');name.textContent=(p.hidden?'Skryté · ':'')+p.display_name;card.append(button,name);
 if(state.is_admin){const hide=document.createElement('button');hide.className='secondary';hide.textContent=p.hidden?'Obnovit':'Skrýt';hide.onclick=async()=>{hide.disabled=true;try{await rpc('album70_hide',{p_id:p.id,p_hidden:!p.hidden});await load()}catch(e){status(e.message,true);hide.disabled=false}};card.append(hide)}
 $('#grid').append(card);observer.observe(img);
}
let viewRequest=0,navigating=false,touchStart=null;
const originals=new Map();
function clearOriginals(){for(const u of originals.values())URL.revokeObjectURL(u);originals.clear()}
function viewerControls(){
 const i=photos.indexOf(activePhoto);
 $('#previous').disabled=navigating||i<=0;
 $('#next').disabled=navigating||(i>=photos.length-1&&$('#more').hidden);
 $('#position').textContent=`${i+1} / ${$('#more').hidden?photos.length:Math.max(photos.length,state.photo_count)}`;
}
async function openPhoto(p){
 activePhoto=p;const ticket=++viewRequest;
 $('#caption').textContent=p.display_name;$('#full').alt=p.display_name;
 $('#full').removeAttribute('src');$('#full').hidden=true;
 $('#viewer-status').textContent='Načítám fotku…';$('#download').disabled=true;
 if(!$('#viewer').open){$('#viewer').showModal();document.body.classList.add('viewing')}
 viewerControls();
 try{
  let url=originals.get(p.path);
  if(!url){const b=await blob(p.path);if(ticket!==viewRequest)return;url=URL.createObjectURL(b);originals.set(p.path,url)}
  if(ticket!==viewRequest)return;
  originals.delete(p.path);originals.set(p.path,url);
  while(originals.size>3){const key=originals.keys().next().value;URL.revokeObjectURL(originals.get(key));originals.delete(key)}
  $('#full').src=url;$('#full').hidden=false;$('#viewer-status').textContent='';$('#download').disabled=false;
 }catch(e){if(ticket===viewRequest)$('#viewer-status').textContent=e.message+' Zkuste fotku otevřít znovu.'}
}
async function movePhoto(step){
 if(!activePhoto||navigating)return;
 const current=activePhoto;let i=photos.indexOf(current)+step;
 if(i<0)return;
 if(i>=photos.length&&!$('#more').hidden){
  navigating=true;viewerControls();
  try{await load(false)}finally{navigating=false}
  if(!$('#viewer').open||activePhoto!==current)return;
 }
 if(photos[i])openPhoto(photos[i]);else viewerControls();
}
$('#previous').onclick=()=>movePhoto(-1);$('#next').onclick=()=>movePhoto(1);
$('#download').onclick=()=>{if(!activePhoto||$('#download').disabled)return;const a=document.createElement('a');a.href=$('#full').src;a.download=activePhoto.display_name;a.click()};
$('#viewer-close').onclick=()=>$('#viewer').close();
$('#viewer').addEventListener('close',()=>{activePhoto=null;++viewRequest;touchStart=null;$('#full').removeAttribute('src');document.body.classList.remove('viewing');clearOriginals()});
$('#viewer').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();movePhoto(e.key==='ArrowLeft'?-1:1)}});
$('#viewer-stage').addEventListener('touchstart',e=>{touchStart=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null},{passive:true});
$('#viewer-stage').addEventListener('touchcancel',()=>{touchStart=null},{passive:true});
$('#viewer-stage').addEventListener('touchend',e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)movePhoto(dx<0?1:-1)},{passive:true});
async function thumbnail(file){const bitmap=await createImageBitmap(file);const ratio=Math.min(1,480/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Nelze vytvořit náhled.')),'image/jpeg',0.75))}
async function upload(path,file){await request('/storage/v1/object/album70/'+path,{method:'POST',headers:{'Content-Type':file.type,'x-upsert':'false','Cache-Control':'no-store'},body:file})}
$('#add').onclick=()=>$('#files').click();
$('#files').onchange=async()=>{
 const files=[...$('#files').files];if(!files.length||busy)return;busy=true;$('#add').disabled=true;$('#refresh').disabled=true;$('#progress').hidden=false;$('#errors').replaceChildren();$('#bar').max=files.length;$('#bar').value=0;let success=0;
 for(let i=0;i<files.length;i++){
  const file=files[i];$('#upload-status').textContent=`Nahrávám ${i+1} z ${files.length}: ${file.name}`;
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Použijte JPG, PNG nebo WebP.');
   if(file.size>10000000||file.size===0)throw new Error('Fotka musí mít nejvýše 10 MB a nesmí být prázdná.');
   const thumb=await thumbnail(file);
   const item=await rpc('album70_reserve',{p_name:file.name,p_type:file.type});
   await upload(item.path,file);await upload(item.thumb_path,thumb);await rpc('album70_finish',{p_id:item.id});success++;
  }catch(e){const li=document.createElement('li');li.textContent=file.name+': '+e.message;$('#errors').append(li)}
  $('#bar').value=i+1;
 }
 busy=false;$('#refresh').disabled=false;$('#files').value='';$('#upload-status').textContent=`Hotovo: nahráno ${success} z ${files.length} fotek.`;await load();
};
$('#refresh').onclick=()=>load();$('#more').onclick=()=>load(false);$('#show-hidden').onchange=()=>load();
$('#admin-open').onclick=()=>$('#admin-dialog').showModal();$('#admin-cancel').onclick=()=>$('#admin-dialog').close();
$('#admin-form').onsubmit=async e=>{e.preventDefault();admin=$('#admin-key').value.trim();try{const s=await rpc('album70_state');if(!s.is_admin)throw new Error('Nesprávný správcovský klíč.');$('#admin-dialog').close();$('#admin-key').value='';$('#admin-error').textContent='';await load()}catch(e){admin='';$('#admin-error').textContent=e.message}};
$('#logout').onclick=()=>{admin='';$('#show-hidden').checked=false;load()};
$('#toggle-uploads').onclick=async()=>{try{await rpc('album70_open',{p_open:!state.uploads_open});await load()}catch(e){status(e.message,true)}};
$('#home').onclick=e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'})};
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});
load();
