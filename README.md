# Cardfolio

Cardfolio is a private household credit card tracker. Everything is on one page:

- **Cardholder stats**: open and closed cards, 5/24 count and when it next drops.
- **To do**, above both tabs: credits ending within a month, annual fee reviews, bonus
  deadlines and pending applications.
- **Cards**: every current account, newest first. A table on desktop and tiles on phones,
  with red decision rows, amber bonuses in progress, blue pending applications, and a
  color key that filters the list. Closed and declined cards sit behind a toggle.
- **Credits**: one group per card type, one row per card, one checkbox column per credit.
  Tap a box to mark a credit used; press and hold (or right-click) to log a partial amount
  or mark it not enrolled. The footer shows the current period's `used/tracked` count.

Card types, credits, reminders, cardholders, sign-in access and exports live in
**Settings**. Changes appear live for everyone signed in.

## How the data is organized

| Table | What it holds |
|---|---|
| `people` | Cardholders (Harrison, Sophia). Separate from sign-in members. |
| `products` | Card types, e.g. "Chase Sapphire Reserve", with issuer, kind (personal / business / other) and usual fee. `slug` is the sheet's short name (`csr`). |
| `accounts` | One row per credit line: applied/approved dates, how it was opened, status, closing date, welcome bonus, notes. |
| `account_products` | The products an account has been over time. An upgrade or downgrade ends one row and starts the next; the account itself stays open. Each row stores its **card number** (`CSR #5`: the 5th time that person held a CSR, counting product changes) and optional **last digits**. |
| `credits` | Recurring credits on a card type: amount, cadence (monthly, quarterly, twice a year, calendar year, card year) and whether to remind. |
| `credit_uses` | A credit used on a specific card in a specific period. Partial amounts add up. `source` is `manual`, `import` or (later) `plaid`. |
| `credit_opt_outs` | Credits not tracked on a specific card ("not enrolled"). |
| `action_rules` | Review reminders (annual fee window, NLL, Ink Cash, RedCard). |

Rules that follow from this:

- **5/24** counts accounts (not products) whose first product is personal and that were
  approved in the last 24 months. Product changes never count.
- **Card numbers** are stored, not recomputed, so adding a forgotten old card never
  renumbers the others. New cards and product changes get the next free number.
- **Card-year credits and annual fee dates** follow the account's approval anniversary.

UI display helpers live in `app/lib/presentation/`, shared card identity/status rendering
in `app/components/CardDetails.tsx`, and generic UI primitives in `app/components/ui.tsx`.

All business logic is plain TypeScript in `app/lib/core/` with no framework imports, so
a future mobile app can share it.

## Local setup

Requirements: Node.js `>=22.13.0` and a Supabase project.

1. Copy `.env.example` to `.env.local` and fill in the Supabase URL, publishable key,
   secret key and `CARDFOLIO_OWNER_EMAIL`.
2. Run the SQL files in `supabase/migrations` in order (Supabase SQL editor or
   `supabase db push`).
3. Import the sheet (below).
4. `npm run dev`.

The browser signs in with a Supabase magic link and then reads and writes the tables
directly; row-level security limits every query to the signed-in member's household.
The server (`/api/session`) only confirms membership, accepts invitations and sends
invites. The secret key is server-only.

## Importing the Google Sheet

`data/sheet-snapshot.json` holds the tracker and credits tabs as of 2026-09-29, plus one
edit that isn't in the sheet: the CFU upgraded back to CSR #5 on 2025-06-01. (If you
re-import from CSV, add that row to the sheet first.)

```bash
npm run db:import-sheet -- --snapshot data/sheet-snapshot.json > import.sql
# or, from fresh CSV downloads of each tab (File → Download → CSV):
npm run db:import-sheet -- --tracker tracker.csv --credits credits.csv > import.sql
```

Then run `import.sql` in the Supabase SQL editor. The script prints notes about anything
it had to interpret (for example "downgraded to biz green" with no Biz Green row).
It refuses to run if Cardfolio already has accounts; add `--replace` to overwrite them.
Delete `import.sql` afterwards.

How the importer reads the sheet:

- A row whose "opened how" is `downgraded` or `upgraded` continues the account whose
  "closed how" says `downgraded to …` / `upgraded to …` on the same date (within two
  weeks), for the same person.
- "downgraded to X" with no row for X keeps the account open as X.
- Credit counts like `7/8` or `h2 4/9` become ticked boxes on the oldest cards; when the
  sheet counts fewer cards than are eligible, cards that were already closed or changed
  (then the newest) are marked not enrolled. Check these once after importing.

## Reminders

Settings → Reminders turns on notifications for the device you're using (each phone or
browser is turned on separately). A daily job (`vercel.json`, 13:00 UTC ≈ 9am Eastern)
notifies when a tracked credit is 7 days, 2 days or 0 days from the end of its period, when
a welcome bonus deadline is 30, 14 or 3 days away, and on the first day a review reminder
matches. Mondays send a summary of everything due. On iPhone, add the site to the home
screen and turn reminders on from there (iOS only allows notifications for home-screen apps).

Needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET`
(see `.env.example`). The time zone defaults to America/New_York (`REMINDER_TIME_ZONE`).

## Signing in

The sign-in email contains a link and a 6-digit code. Typing the code signs in the exact
browser or home-screen app it's typed into; sessions then last until you sign out. For the
code to appear, the Supabase **Magic Link** email template (Authentication → Emails) must
include `{{ .Token }}`, for example:

```html
<h2>Sign in to Cardfolio</h2>
<p>Your code: <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a>.</p>
```

## Card last digits from 1Password

`scripts/1password-last-digits.sh` uses the 1Password CLI to print each saved card's title,
cardholder and last 4 digits (5 for Amex) as CSV. It never prints full numbers or CVVs.

## Google Sheet copy (optional)

Cardfolio can overwrite the `tracker`, `credits` and `stats` tabs of a separate
spreadsheet a few seconds after every change, and on demand from Settings. Don't point it
at a sheet with other tabs you edit by hand.

1. In Google Cloud, create a project, enable the **Google Sheets API**, and create a
   **service account** with a JSON key.
2. Create an empty spreadsheet and share it (Editor) with the service account's email.
3. Set these environment variables in Vercel:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: the service account's email
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: the key's `private_key` value (keep the `\n`s)
   - `CARDFOLIO_EXPORT_SPREADSHEET_ID`: the ID from the spreadsheet URL

Settings also has CSV downloads of the same three tables.

## Deployment

Import the repository into Vercel and add the environment variables from `.env.example`
for Production and Preview. Every push to `main` deploys to production. Add the
production URL to Supabase's Authentication URL Configuration (Site URL and redirect
URLs) so magic links work.

The `20260929000001_portfolio_v2` migration renames the old tables to `legacy_*` and the
new code only reads the new tables, so apply the migration and the import when you
deploy this version.

On a phone, open the site and use **Add to Home Screen** to install it like an app.

## Commands

- `npm run dev`: local development
- `npm run build`: production build
- `npm test`: unit tests for the portfolio logic (runs against the sheet snapshot)
- `npm run lint`: lint the source
- `npm run check`: lint, type-check, test and build
- `npm run db:import-sheet`: generate the sheet import SQL
