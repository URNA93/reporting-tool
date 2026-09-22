# Jednorázové propojení s Google Sheets

1. V tabulce **GFS Reporting – Data** otevři **Rozšíření → Apps Script**.
2. Obsah souboru `Code.gs` nahraď kódem z tohoto adresáře.
3. V **Nastavení projektu → Vlastnosti skriptu** přidej `GFS_SECRET` se stejnou hodnotou, která je uložená v prostředí webu.
4. Zvol **Nasadit → Nové nasazení → Webová aplikace**. Spouštět jako vlastník, přístup „Kdokoli“.
5. URL nasazení ulož do prostředí webu jako `GOOGLE_SHEETS_WEBHOOK_URL` a znovu web publikuj.

Příjemce kontroluje tajný klíč, zapisuje reporty idempotentně podle jejich ID a před zápisem používá zámek proti souběhu.

## Mazání položek

Smazání položky ve webu smaže řádek z listu **Položky**. Smazání celého reportu smaže jeho řádek z listu **Reporty** i všechny jeho položky. Pokud je Google tabulka dočasně nedostupná, web operaci zařadí do fronty a správce ji dokončí tlačítkem „Synchronizovat tabulku“.
