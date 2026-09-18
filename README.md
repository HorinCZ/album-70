# Album 70

Web pro společnou galerii a nahrávání fotek bez účtů hostů.
Připojeno k Supabase Free; hosting přes GitHub Pages.
Odkaz s tokenem ani správcovský klíč nepatří do tohoto repozitáře.

## Zapojení

1. Vytvořit nový projekt Supabase na tarifu Free.
2. Vygenerovat dvě nezávislá náhodná 32bajtová tajemství: guest a admin.
   Do `setup.sql` dosadit pouze jejich SHA-256 hex hashe, potom spustit SQL.
3. Do `config.js` zadat adresu projektu a veřejný legacy `anon` JWT klíč.
   Nikdy nepoužít `service_role` ani secret key.
4. Zveřejnit `index.html`, `style.css`, `app.mjs`, `config.js` na GitHub Pages.
   Odkaz pro hosty: `https://HOST/#album=GUEST_SECRET`.
5. Správce otevře stejný odkaz, klikne na Správa alba a zadá ADMIN_SECRET.
   Klíč se drží pouze v paměti stránky, neukládá se do localStorage.

## Vlastnosti

- Originály JPG/PNG/WebP do 10 MB; oddělené malé JPEG náhledy.
- Galerie, stažení jednotlivého originálu, nahrání více fotek.
- Správce může fotky skrýt/obnovit a zastavit/povolit nahrávání.
- Originály jsou v privátním bucketu. Přístup kontroluje SQL na serveru.
- Stažení používá autorizovaný POST pro vytvoření odkazu platného 60 sekund.
  Již stažené soubory nelze skrytím odvolat; vydaný dočasný odkaz může ještě platit.
- Token se posílá v CORS standardně podporované hlavičce x-client-info;
  nejde o Supabase přihlašovací heslo. Ověřeno na živém API i při nahrání z prohlížeče.
- Kvóta 900 MB včetně náhledů. Každá rezervace předem započítává 20 MB,
  po dokončení se přepočítá podle skutečné velikosti objektů v úložišti.
  Neúspěšné rezervace je třeba administrátorsky vyčistit v Supabase;
  automaticky se neuvolňují, aby pozdní upload nepřekročil kvótu.
- Skrytí není smazání a neuvolní místo. Hosté nemají DELETE ani UPDATE práva.
- Stránka nemá analytiku, externí fonty ani veřejně vložené osobní jméno.
- HEIC a videa nejsou v této verzi podporované. Neprobíhá tichá komprese originálů.
- Free Supabase má limity přenosu a může projekt po neaktivitě pozastavit.

## Ověření před spuštěním

- Bez tokenu / s neplatným tokenem nelze číst fotky ani nahrávat.
- Guest může rezervovat, nahrát, dokončit a zobrazit foto; nemůže spravovat.
- Originály nelze přepsat ani smazat přes API.
- Admin může skrýt/obnovit foto, skryté foto nelze nově načíst jako guest.
- Pozastavení blokuje rezervace i nové zápisy do storage.
- Dva návštěvníci vidí stejné nahrané fotky po obnovení galerie.
- Kvóta se drží při souběžných rezervacích; thumbnail i originál se započítávají.
