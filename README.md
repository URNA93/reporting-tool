# GFS Visionary Reporting

Interní webová aplikace pro evidenci produkce, projektů, analýz, poradenství a úvodních rozhovorů. Zdrojem pravdy je Supabase; Google tabulka je pouze synchronizovaný výstup.

## Co aplikace umí

- Přihlášení a registraci přes Supabase Auth; registrace je omezená na firemní doménu.
- Role `user`, `manager` a `admin`; pravidla jsou vynucená také databázovými RLS politikami a RPC funkcemi.
- Administraci uživatelů, pozic, rolí, stavu účtu, přejmenování a pozvánek/resetu hesla.
- Reportovací období automaticky od dne po minulém prvním úterý do aktuálního prvního úterý včetně.
- Položky typu Projekt, Analýza, Poradenství a Úvodní rozhovor; objem projektů a poradenství je vždy v BU.
- Proces Projekt → Analýza → Poradenství se zachováním vlastníka, historie, termínu a Přepadů.
- Automatické Přepady nedokončených projektů do dalšího období, bez duplicity a se zachováním procesní fáze.
- Sdílené filtrování, metriky, nejbližší termíny a stránkování položek.
- Synchronizaci reportů a položek do Google Sheets přes Apps Script webhook.

## Technologie

- TypeScript, React 19, Next.js 16 přes Vinext/Vite 8
- Tailwind CSS 4, shadcn/ui a Lucide
- Supabase Auth + PostgreSQL + RLS
- Cloudflare Worker / Sites runtime
- Google Apps Script pro jednosměrnou synchronizaci do Sheets
- Node.js `>= 22.13.0`, npm

## Spuštění lokálně

```bash
git clone https://github.com/URNA93/reporting-tool.git
cd reporting-tool
npm install
cp .env.example .env.local
npm run dev
```

Vývojový server běží na adrese, kterou vypíše Vite. Kontroly spusťte takto:

```bash
npm test
npm run lint
npm run build
```

## Konfigurace

Vytvořte lokální soubor `.env.local` podle `.env.example`. Nikdy jej necommitujte.

| Proměnná | Povinná | Účel |
| --- | --- | --- |
| `SUPABASE_URL` | ano | URL Supabase projektu |
| `SUPABASE_PUBLISHABLE_KEY` | ano | publishable/anon klíč Supabase |
| `REPORTING_COMPANY_DOMAIN` | ano | přesná doména povolená pro registraci, např. `@firma.cz` |
| `REPORTING_MASTER_ADMIN_EMAIL` | ano | skrytý hlavní účet správce |
| `GOOGLE_SHEETS_WEBHOOK_URL` | ne | URL nasazeného Apps Script web appu |
| `GOOGLE_SHEETS_WEBHOOK_SECRET` | ne | tajemství posílané k webhooku |
| `GOOGLE_SHEETS_SPREADSHEET_URL` | ne | admin-only odkaz na cílovou Google tabulku |

Pro Apps Script nastavte v **Project Settings → Script properties**:

| Vlastnost | Účel |
| --- | --- |
| `GFS_SECRET` | musí odpovídat `GOOGLE_SHEETS_WEBHOOK_SECRET` |
| `GFS_SPREADSHEET_ID` | ID cílové Google tabulky |

## Databáze a migrace

Produkční databáze je Supabase. Migrace jsou seřazené v `supabase/migrations/` a aplikují se chronologicky v SQL Editoru nebo přes Supabase CLI. Jsou nedestruktivní; před aplikací každé nové migrace ověřte stav produkce a zálohujte databázi.

Aktuálně připravené, ale dosud neověřené v produkci, jsou migrace `202609180001_add_introductory_conversations.sql` (Úvodní rozhovor) a `202609220001_externalize_access_configuration.sql` (přesun přístupové konfigurace mimo zdrojový kód).

Po založení **nového** Supabase projektu nastavte po migracích interní databázovou konfiguraci (hodnoty musí odpovídat proměnným hostingu):

```sql
insert into public.reporting_system_config (config_key, config_value)
values
  ('company_domain', 'your-company.example'),
  ('master_admin_email', 'admin@example.com')
on conflict (config_key) do update
set config_value = excluded.config_value, updated_at = now();
```

Toto proveďte pouze v Supabase SQL Editoru s administrátorským přístupem. Tabulka nemá pro běžné uživatele žádnou RLS politiku.

Staré složky `db/`, `drizzle/` a `examples/d1/` jsou historické artefakty původní D1 verze. Nejsou zdrojem produkčních dat ani aktuálních Supabase migrací; nemažte je bez samostatné revize.

## Struktura

```text
app/                        Next.js stránky a API route handlery
components/                 aplikační a UI komponenty
lib/                        doménová logika, Supabase, validace, synchronizace
supabase/migrations/        zdrojově řízené Supabase migrace
integrations/google-sheets/ Apps Script webhook a jeho návod
public/                     loga a ikony
tests/                      testy přístupu, období, zabezpečení a vykreslení
scripts/                    pomocné skripty pro build a CI
worker/                     Cloudflare Worker vstup
```

## Bezpečnostní pravidla

- Do Gitu nikdy nevkládejte `.env*`, přístupové klíče, tokeny, databázové dumpy ani `.clasp.json`.
- Role, vlastnictví položek a editace se nesmějí vynucovat jen ve frontendu; platí RLS a databázové RPC funkce.
- E-mail ani textové jméno nejsou primární vazbou dat. Vazby používají `auth.users.id` / `user_id`.
- Před nasazením nastavte všechny povinné proměnné v hostingu a následně ověřte přihlášení hlavního správce.

## Spolupráce přes GitHub

Pracujte v samostatné větvi, před prací proveďte `git pull --rebase`, potom `git add`, `git commit` a `git push`. Změny slučujte přes Pull Request. Před PR vždy spusťte `npm test`.
