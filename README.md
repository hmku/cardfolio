# Cardfolio

Cardfolio is a private household credit card tracker. Everything is on one page:

- **Cardholder stats**: open and closed cards, 5/24 count and when it next drops.
- **To do**, above both tabs: credits ending within a month, annual fee reviews, bonus
  deadlines and pending applications.
- **Cards**: every current account, newest first. A table on desktop and tiles on phones,
  with red decision rows, amber bonuses in progress, blue pending applications, violet
  fee cards kept past their first year, and a
  color key that filters the list. Closed and declined cards sit behind a toggle.
- **Credits**: one group per card type, one row per card, one checkbox column per credit.
  Tap a box to mark a credit used; press and hold (or right-click) to log a partial amount
  or mark it not enrolled. The footer shows the current period's `used/tracked` count.
  Closed cards and earlier products are hidden behind "Show closed cards".

Card types and their credits, review rules, notifications, cardholders, sign-in access and
exports live in **Settings**. Card types with no open cards and no credits are tucked behind
a "Show N card types" button. Fields save when you leave them. Changes appear live for
everyone signed in.

## How the data is organized

| Table | What it holds |
|---|---|
| `people` | Cardholders. Separate from sign-in members (someone can hold cards without signing in). |
| `products` | Card types, e.g. "Chase Sapphire Reserve", with issuer, kind (personal / business / other) and usual fee. `slug` is the sheet's short name (`csr`). |
| `accounts` | One row per credit line: applied/approved dates, how it was opened, status, closing date, welcome bonus, notes. |
| `account_products` | The products an account has been over time. An upgrade or downgrade ends one row and starts the next; the account itself stays open. Each row stores its **card number** (`CSR #5`: the 5th time that person held a CSR, counting product changes) and optional **last digits**. |
| `credits` | Recurring credits on a card type: amount, cadence (monthly, quarterly, twice a year, calendar year, card year) and whether to remind. |
| `credit_uses` | A credit used on a specific card in a specific period. Partial amounts add up. `source` is `manual`, `import` or (later) `plaid`. |
| `credit_opt_outs` | Credits not tracked on a specific card ("not enrolled"). |
| `action_rules` | Review rules (annual fee window, NLL, Ink Cash, RedCard). |
| `agent_keys` | Keys for AI agents (hash only). |
| `change_log` | What agents changed and the email or message it came from. |

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

## Set up your own copy

Cardfolio is meant to be self-hosted: each household runs its own copy on free tiers of
[Supabase](https://supabase.com) (sign-in and database) and [Vercel](https://vercel.com)
(the website). One copy holds one household; invite the other people in it from Settings.
You'll need Node.js `>=22.13.0` and about half an hour.

### 1. Get the code

Fork this repository on GitHub (Vercel deploys from your fork), then:

```bash
git clone https://github.com/<you>/cardfolio.git
cd cardfolio
npm install
```

### 2. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Create the tables by running every file in `supabase/migrations/` **in filename order**:
   either paste each one into the SQL editor and run it, or use the Supabase CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates one household and four example review rules (see Settings → Review rules).
3. **Authentication → URL Configuration**: set the Site URL to `http://localhost:3000` for
   now and add `http://localhost:3000/**` to the redirect URLs. You'll add your Vercel URL
   in step 5.
4. **Authentication → Emails → Magic Link**: include `{{ .Token }}` so sign-in emails carry
   a 6-digit code (see [Signing in](#signing-in) for a template).
5. Supabase's built-in email sender only sends a few emails an hour. That's enough to try
   Cardfolio, but for everyday use set up custom SMTP under **Authentication → Emails →
   SMTP Settings** (any provider works, for example Resend or a Gmail app password).

### 3. Configure and run locally

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable (anon) key on the same page |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret (service_role) key. Server-only; never share it. |
| `CARDFOLIO_OWNER_EMAIL` | Your email. The first sign-in with it becomes the household owner. |

The other variables are optional (notifications, Google Sheet copy); leave them blank.

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the owner email.

### 4. Add your cards

The empty page walks you through it:

1. **Add a cardholder** for each person who holds cards. Initials label each card
   (csp AD1 is that person's first Sapphire Preferred); change them in Settings.
2. **+ Add card** for each card, open or closed. Pick a card type or choose
   "+ New card type…" to create one. Upgrades and downgrades go on the card itself
   ("Change product") so the history stays on one account.
3. In **Settings → Card types and credits**, add each card type's statement credits (amount
   and how often it resets) to track them on the Credits tab.
4. The example review rules match card types by short name (`biz plat`, `biz gold`, `cic`,
   `redcard`); the annual fee review works for any card with a fee. Turn off the ones you
   don't need in Settings.
5. **Settings → Who can sign in**: invite anyone else in the household by email.

### 5. Deploy to Vercel

1. In Vercel, **Add New → Project** and import your fork. The defaults work.
2. Add the environment variables from `.env.local` (Production and Preview), then deploy.
3. Back in Supabase **Authentication → URL Configuration**, set the Site URL to your Vercel
   URL (for example `https://cardfolio-you.vercel.app`) and add `https://<that-url>/**` to
   the redirect URLs.

Every push to `main` then redeploys. On a phone, open the site and use **Add to Home
Screen** to install it like an app.

### 6. Optional extras

- [Reminders](#reminders): push notifications for ending credits, bonus deadlines and reviews.
- [Google Sheet copy](#google-sheet-copy-optional): a read-only spreadsheet kept in sync.
- [Importing a Google Sheet](#importing-a-google-sheet-optional): bulk-load an existing tracker.
- [Agents (MCP)](#agents-mcp): let Claude or another AI agent update Cardfolio for you.

The browser signs in with a Supabase magic link and then reads and writes the tables
directly; row-level security limits every query to the signed-in member's household.
The server (`/api/session`) only confirms membership, accepts invitations and sends
invites. The secret key is server-only.

## Importing a Google Sheet (optional)

Most people should add cards by hand (above). The importer exists to move the original
owner's spreadsheet into Cardfolio, and reads that sheet's layout: a tracker tab with
columns for who, card short name (`csr`), number, applied, approved, how opened, offer,
annual fee, bonus earned, closed and how closed; and a credits tab with card, credit,
amount, frequency and a used count like `7/8`. Short names it knows are listed in
`PRODUCT_CATALOG` in `app/lib/core/sheet-import.ts`. If your sheet is laid out differently,
adapt that file or add cards by hand.

`data/sheet-snapshot.json` is a frozen copy of the original sheet from 2026-09-29. The app
never reads it; the tests use it as sample data.

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

Settings → Notifications turns on notifications for the device you're using (each phone or
browser is turned on separately). A daily job (`vercel.json`, 13:00 UTC ≈ 9am Eastern)
notifies when a tracked credit is 7 days, 2 days or 0 days from the end of its period, when
a welcome bonus deadline is 30, 14 or 3 days away, and on the first day a review rule
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

## Card last digits from 1Password (optional)

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

## Agents (MCP)

Cardfolio is also an MCP server at `/api/mcp`, so an AI agent can read your cards and record
new cards, approvals, product changes, closures, bonuses and credits, for example from issuer
emails. Create a key in **Settings → Agents** and see [docs/agents.md](docs/agents.md) for how to
connect Claude Code or another client, and what each tool does. Agent changes are listed under
Settings → Agents.

## Commands

- `npm run dev`: local development
- `npm run build`: production build
- `npm test`: unit tests for the portfolio logic (runs against the sheet snapshot)
- `npm run lint`: lint the source
- `npm run check`: lint, type-check, test and build
- `npm run db:import-sheet`: generate the sheet import SQL
