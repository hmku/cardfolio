# Cardfolio to-do

Open items, newest decisions first within each section. Check items off (`- [x]`) when
done and move them to **Done** with the date.

## Needs Harrison

- [ ] **Turn on reminders** on each device (Settings → Reminders → Turn on, then Send a test).
      On iPhone, add the site to the home screen first and turn it on from there. Sophia too.
- [ ] **Fill in the last digits 1Password didn't cover** (card drawer → Last digits):
  - No 1Password entry: al biz HK3, biz gold SL1, biz green HK3 and HK4, biz plat SL3 and
    SL4, cfu HK1–3, csr HK5, citi custom cash HK1, hh base HK1, redcard SL4, united explorer
    HK1–2, united gateway HK2. Amex and Chase sometimes keep the number on a product change,
    so these may share digits with the card before or after.
  - Check: 1Password "United Gateway (HK1)" wasn't entered, since the account went
    Explorer → Gateway → Explorer → Gateway; put it on whichever product had that number.
  - Check: csr HK3 got the 1Password "CSR (HK3)" digits, though 1Password doesn't mark it closed; it may be the current
    card (csr HK5).
  - Check: biz green SL3 got "Biz Green (SL3) (downgraded)" and biz green SL4 got
    1Password "Biz Green (SL3) (was biz plat SL4)"; rename that 1Password entry to SL4.
  - Check: amex gold (SL1) got the digits from the untagged 1Password "Amex Gold".
  - Not entered (no matching Cardfolio card): Amex Biz Gold Jacq, the Biz Green
    employee/additional cards (G1-HK, G1-SL, G2-SL, G4-HK, P1-HK, P2-HK, P2-SL, P3-HK, P3-VC,
    P4-VC, P6-HK), AA Aviator (SK1) and (SL1-HK), JetBlue Biz (SL1-HK), Amex Employee Cards,
    Beniversal, Navia and Fidelity.
- [ ] **Check the imported data** in the app:
  - CSR #5 upgrade date is recorded as 2025-06-01 (the day is a guess).
  - Two accounts were assumed still open because the sheet had no row after a downgrade:
    Harrison's United Gateway (from United Explorer #2, Dec 2024) and Sophia's Biz Green #2
    (from Biz Gold #1, Apr 2026). Close them if that's wrong.
  - Credit checkboxes were guessed from the sheet's `used/total` counts; fix any wrong ones.
- [ ] **Check the Amex Platinum credits** (added 2026-09-29 from public 2026 benefit lists; the
      Amex site itself couldn't be reached): Fine Hotels $300/half, Resy $100/qtr, lululemon $75/qtr,
      Airline fee $200/yr, Digital entertainment $25/mo, Uber Cash $15/mo, Uber One $120/yr,
      Walmart+ $12.95/mo, CLEAR $209/yr, Oura $200/yr, Equinox $300/yr. Delete any you won't
      use in Settings → Card types and credits, or mark them not enrolled per card. Uber Cash is $35 in
      December; the app can't vary a monthly amount yet, so log the extra $20 as a partial use.
- [ ] Stop editing the tracker, credits and stats tabs of the Google Sheet once the app is
      the source of truth.
- [ ] **Monarch Money leftovers** from the 2026-11-01 manual cleanup:
  - Two closed Monarch cards match nothing in Cardfolio: "HARRISON KU -11017 (...1017)" and
    "-51044 (...1044)" (last synced 2022). Rename them or add the cards to Cardfolio.
  - Guesses to confirm: Sophia's Monarch "delta biz gold SL4" (...1002, first charge April 2026)
    doesn't match Cardfolio's SL4 last digits (31004). Monarch's "biz plat HK9" (...1005) also
    holds biz plat HK6's history (same last 4).
  - Monarch's cic HK8 ends in ...3624, but Cardfolio (from 1Password) has ...9182. Check the
    Chase app or the physical card: if the card was replaced, update the last digits in
    Cardfolio and 1Password.
  - No Monarch account yet for delta biz gold SL5 and Sophia's venture, citi premier, ha biz,
    aa mileup and redcards. Connect them in Monarch if wanted.
  - Until there's a real sync, rename and close Monarch accounts by hand whenever a card
    opens, changes product or closes in Cardfolio.

## Optional setup

- [ ] **Google Sheet copy**: create a Google Cloud service account with the Sheets API,
      share an empty spreadsheet with it, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` and `CARDFOLIO_EXPORT_SPREADSHEET_ID` in Vercel
      (see README).

## Review follow-ups

- [ ] Make account edits (`updateAccount`, including moving a card to another cardholder)
      transactional like the new `cardfolio_*` functions. New cards, product changes/undo and
      credit uses already are.
- [ ] Prevent stale portfolio reloads from replacing newer data; clear pending realtime
      reload and sheet-sync timers on cleanup.

## Agents

- [ ] (Parked) Agent access over MCP. Built and then removed on 2026-09-30 because clients
      like ChatGPT and claude.ai connectors need an OAuth sign-in, not a pasted key; agents use
      the web app for now. To bring it back, restore `app/api/mcp/`, `app/lib/agent/`,
      `app/components/AgentSettings.tsx` and `docs/agents.md` from commit `d778d8b`, re-add the
      `agent_keys` and `change_log` tables (and the `'agent'` credit-use source) from
      `20260930000001_agent_api.sql` in a new migration, then add OAuth in front of `/api/mcp`.

## Ideas / later

- [ ] Try the README's "Set up your own copy" guide from a fresh fork with a new Supabase
      project and Vercel site, and fix anything that trips.

- [ ] Plaid Phase 1 (connect banks, link cards) is built and in Sandbox (`PLAID_ENV=sandbox`).
  - [ ] Harrison: when it works, set `PLAID_ENV=production` in Vercel, redeploy, and connect
        the most valuable logins first (10 free Trial connections for good). Sophia connects
        her own. Check each card's match in Settings → Bank connections.
  - [ ] Check OAuth banks (Chase, Capital One, Citi…) on the iPhone home-screen app: Link may
        need a `redirect_uri` registered in the Plaid dashboard for that.
- [ ] **Finance backbone follow-ups** (built 2026-11-02 on branch `claude/gracious-mccarthy-z3tj8l`):
  - [ ] Apply `supabase/migrations/20261102000002_finance.sql` to the Supabase project
        **before** deploying this code: the existing connect flow now writes balance
        columns that only exist after it.
  - [ ] Set `PLAID_WEBHOOK_URL=https://cardfolio.harrisonku.com/api/plaid/webhook` in Vercel
        (Production) and redeploy; existing logins switch to it on their next sync. Check in
        Plaid's dashboard (Developers → Webhooks/Logs) that deliveries return 200.
  - [ ] Check the second cron (`/api/cron/sync`, 10:00 UTC) shows in Vercel → Settings → Cron
        Jobs and that `maxDuration = 300` is allowed on the plan (Hobby with Fluid compute allows
        300s; otherwise lower it in `app/api/cron/sync/route.ts` and `app/api/plaid/sync/route.ts`).
  - [ ] Add the manual account "Edgar Street Capital": Accounts tab → "+ Add a manual
        account", kind Private investment, Asset, current value, owner. It then shows on
        Investments as one position. Update the value there whenever a statement arrives
        (each save adds a point to the history).
  - [ ] Investments/Accounts guesses to check with real data: Plaid investment accounts'
        cash shows up as a cash holding (otherwise the Investments total misses uninvested
        cash; an account with no holdings at all is counted at its balance); which Plaid
        subtypes count as Retirement (`RETIREMENT_SUBTYPES` in `app/lib/core/investments.ts`,
        HSAs included); activity type grouping (`activityKind`).
  - [ ] Net worth history ignores archived manual accounts entirely (also before they were
        archived); a closed Plaid account carries its last balance forward. Revisit if that
        reads wrong (e.g. store an archived date).
  - [ ] Idea: backfill investment value history from investment transactions and prices
        (Plaid gives 24 months of transactions but no past balances).
  - [ ] Try a Sandbox sync end to end ("Sync now" with First Platypus Bank; Sandbox
        `user_transactions_dynamic` gives changing transactions) and look at the tabs.
  - [x] Pages to build on `app/lib/finance-data.ts`: Transactions (search, filters,
        categorize, bulk edit, rules incl. `applyRuleToExisting`), Cash flow (by month and
        category), Settings for categories and rules, Investments and Accounts (all built
        2026-11-02, see Done).
  - [ ] Disconnecting a login deletes its accounts, transactions, holdings and snapshots
        (cascade). Consider keeping history (soft-delete the item) before connecting real banks.
  - [ ] Guesses to check with real data: default category mapping (Plaid PFC v2 codes in
        `cardfolio_seed_categories`), and that Amex/Chase return Liabilities for every card.
  - [ ] Supabase security advisor will flag the `plaid_item_status` view (it filters by
        `is_cardfolio_member` itself rather than using security_invoker); that's intended.
- [ ] **Transactions and Cash flow follow-ups** (pages built 2026-11-02; Transactions and Cash
      flow are done in the "Pages to build" item above):
  - [ ] Look at both tabs with real (or Sandbox) transactions, on a phone and on desktop, in
        light and dark mode. They were only built against tests and type checks: check the date
        groups, the row layout at phone width, the bulk bar, the month chart's tooltip and bars,
        and that linked cards show their short name (e.g. "biz plat HK9").
  - [ ] Check that Plaid's merchant logos (`logo_url`) load; rows fall back to the category
        emoji when they don't.
  - [ ] Category picks made in bulk count as "set by hand" (never overwritten by rules or sync).
        Decide whether choosing a category should also mark a transaction reviewed (Monarch does).
  - [ ] Ideas: split a transaction, tags, recurring/subscription detection, a budget per
        category, CSV export of the filtered list, a "needs review" count on the tab, keyboard
        shortcuts (j/k, c for category), editing rules in place (today: delete and add again).
  - [ ] Applying a rule to past transactions updates every non-manual match in one request; if
        the household reaches tens of thousands of transactions, move it into a Postgres function.
  - [ ] Cash flow counts uncategorized money in as income and money out as spending. If card
        payments or transfers land uncategorized, they inflate both; fix their category (or add a
        rule) rather than changing the math.
- [ ] Plaid Phase 3 left: link card payments between accounts (checking → card).
- [ ] **Card features from Plaid follow-ups** (built 2026-11-02, see README → "What a linked card adds"):
  - [ ] Once real cards are synced, check the credit matcher against actual Amex descriptions
        (Transactions tab, search "credit"): fix aliases in `CREDIT_ALIASES`
        (`app/lib/core/card-plaid.ts`) for anything missed or mis-matched. Guesses: Uber Cash
        is paid into the Uber app, so it probably never shows on the card (only Uber One does);
        the airline credit may post under the airline's name (not matched, on purpose: it looks
        like a ticket refund).
  - [ ] If an alias list isn't enough, add a per-credit keyword override (a `match_keywords`
        column on `credits` plus a field in Settings → Card types and credits).
  - [ ] Dismissed suggestions are remembered per browser (localStorage), so Sophia still sees
        ones Harrison dismissed. Move them to a small table if that's annoying.
  - [ ] A credit posted early in the next period (bought Oct 31, credited Nov 2) is suggested
        for the new period; check how often that happens.
  - [ ] Check that bonus spend roughly matches the issuer's tracker for a card in its window,
        and that Liabilities' due dates and `is_overdue` look right for Amex and Chase.
  - [ ] Not tried in a browser with real data yet (built without signing in): open a linked
        card's drawer, the Credits "From your bank" list and the Cards Balance column on a
        phone and desktop.
- [ ] Plaid background (Harrison and Sophia each connect their own bank logins). Research from 2026-10-07 (plaid.com was unreachable from
      the agent's container, so check these on the Plaid Dashboard):
  - Sign up as a new team for the free **Trial plan** (teams created after 2026-04-15; no
    company or security questionnaire needed). Real data, includes Transactions and
    Liabilities, but a lifetime cap of **10 Items** (one per bank login), and removing or
    re-linking an Item doesn't free a slot. Link the most valuable logins first.
  - Paid pay-as-you-go is billed per Item per month per product. Prices aren't public;
    reported ~$0.30 per Item per month for Transactions (Liabilities unknown), so roughly
    $5–8/month for 8–12 logins.
  - Chase consent expires (6 or 12 months), and the login must then be re-linked.
  - Plaid's account `mask` is up to 4 characters, so Amex's 5 digits won't match exactly;
    match on the last 4.
  - Cheap fallback: SimpleFIN Bridge ($15/year, up to 25 banks, daily transactions and
    balances, but no due dates or statement balances).
- [ ] Plaid details: connect card accounts, detect statement credits, track bonus spend and fee
      postings (`credit_uses.source = 'plaid'` is already in the schema). Needs a Plaid
      production account. Plaid can't report autopay settings directly, but payments on the
      due-date schedule (often labeled "AUTOPAY") show it; flag cards with a balance due and
      no payment by the due date. It has no opening dates or product-change history.
- [ ] Credit history view: past periods per card (e.g. last year's Dell credit on every Biz Plat).
- [ ] Native mobile app (Expo) reusing `app/lib/core`, only if the home-screen web app
      feels limiting.
- [ ] Shared credits across card types (Airline fee, Fine Hotels and CLEAR are identical on
      amex plat and biz plat). For now they're kept in sync by hand: same name, amount, cadence
      and reminder setting. A real merge needs a credit-to-product link table plus grid,
      Settings, reminder and export changes; only worth it if more overlaps show up.
- [ ] Drop the `legacy_*` tables once nothing from the v1 app is needed.
- [ ] Supabase security advisor: `is_cardfolio_member` / `is_cardfolio_owner` are callable
      via RPC (they only reveal the caller's own membership); consider revoking `anon`.

## Done

- 2026-11-02: Accounts and Investments pages. Accounts: net worth, assets and debts with a
  net worth chart (1M–All, change over the period) from `balance_snapshots`; accounts grouped
  Cash / Credit cards (short card name, statement balance, due date) / Investments /
  Retirement / Loans / Other with totals; owner filter and inline owner picker; account
  drawer with balance history, details and "Show transactions"; manual accounts
  add/edit/archive/delete. Investments: value, cost basis and unrealized gain, value chart,
  allocation by type and by account, holdings by security with per-account rows, sorting,
  account and owner filters, recent activity with type filter. Pure logic in
  `app/lib/core/investments.ts` (tested); hand-rolled SVG charts in
  `app/components/FinanceChart.tsx`. Checked with fake data only, not against real Plaid data.

- 2026-11-02: Members can be barred from investments (`household_members.hide_investments`,
  migration `20261102000003_hide_investments.sql`, applied). Row-level security hides Plaid
  investment accounts (brokerage, IRA, 401(k)), their holdings, investment transactions,
  transactions and balance history, and manual accounts of an investment kind; the bank
  connections list hides them too. Set for the test member devtest068. There's no toggle in
  Settings yet: `update household_members set hide_investments = true where email = …`.

- 2026-11-02: Transactions and Cash flow tabs. **Transactions**: search (debounced, merchant,
  description and notes), date presets (this month, last month, last 90 days, this year,
  custom), and a Filters panel (category incl. Uncategorized, money in/out, accounts, show
  excluded, unreviewed only); a list grouped by day that loads 100 at a time as you scroll;
  rows show the merchant logo or category emoji, category, the account (linked cards by short
  name), amount and pending. Tap a row for a drawer: category (searchable), notes, exclude
  from cash flow, reviewed, and "Always categorize <merchant> as …" (adds a rule, then offers
  to apply it to past transactions). Checkboxes select rows for bulk category, exclude/include
  and mark reviewed. "Manage categories" edits categories (emoji, name, kind, delete) and
  rules. **Cash flow**: a month picker (or last 12 months), income, spending and net with the
  savings rate, a 12-month income vs spending chart (tap a month), spending and income by
  category and top merchants; tapping a category or merchant opens Transactions filtered to it
  for that period. Aggregation in `app/lib/core/finance.ts` (`cashFlowBreakdown`,
  `datePresetRange`, …), tested. No database changes.
- 2026-11-02: Card features from Plaid (Phase 3, `app/lib/core/card-plaid.ts`, tests in
  `tests/card-plaid.test.ts`). Linked cards show their balance and statement ("$1,234 due
  Nov 20") in the Cards table (new Balance column), tiles and the drawer's "From your bank"
  section; To do and push reminders get "Pay" items for unpaid statements due within 5 days
  and "Overdue" alerts. Bonus tags and To do items show spend so far ("$3,210 of $5,000 spent,
  48 days left") with a warning when Plaid's history starts after approval. Statement credits
  in a card's transactions are suggested under "From your bank" on Credits and in the drawer
  (Record saves the use with source `plaid`; Dismiss hides it in that browser), and matching
  cells get a dashed green outline. Annual fee postings show in the drawer and on the
  keep-or-close review. No database changes. Unlinked cards look as before.

- 2026-11-02: Finance backbone (Plaid Phase 2). New migration `20261102000002_finance.sql`:
  balances and card statement details on `plaid_accounts` (now readable by members),
  `transactions` (cents, positive = money in), `categories` (default set seeded from Plaid's
  categories), `category_rules`, `securities`, `holdings`, `investment_transactions`,
  `manual_accounts` and daily `balance_snapshots`; checked on an empty Postgres (PGlite) with
  RLS tests, not yet applied to Supabase. Sync (`db/plaid-sync.ts`) runs after connecting,
  on "Sync now" in Settings → Bank connections, on verified Plaid webhooks and daily
  (`/api/cron/sync`). New tabs Transactions, Cash flow, Investments and Accounts with
  placeholder lists; the to-do list and search stay on Cards and Credits. Not run against
  Plaid yet.
- 2026-11-02: Two connect buttons in Settings → Bank connections: "Connect a bank or card"
  (transactions plus card due dates/balances) and "Connect investments" (holdings plus cash
  transactions); every account in a login is kept, only cards are matched. Tested both in
  Sandbox on the branch preview. The live site now uses real banks (`PLAID_ENV=production`
  for Production; Preview stays on Sandbox).
- 2026-11-02: Plaid Phase 1 tested in Sandbox on production as devtest068: Link opened,
  First Platypus Bank connected with its two fake credit cards (no auto-match, as expected),
  a manual link saved and greyed that card out in the other dropdown, and Disconnect removed
  the item at Plaid and here (tables empty afterwards). The card dropdown now lists open
  cards only (plus whatever is already linked).
- 2026-11-02: Card drawer quick actions. Under the title, a status line ("Open since …",
  "Pending · applied …", "Closed …") and buttons: open cards get "Upgrade / downgrade" and
  "Close card"; pending cards get "Approved" and "Declined". Each opens a small panel (date
  defaulting to today; product changes also take the new card type, fee, optional new last
  digits and an Upgrade/Downgrade toggle; Approved takes optional last digits) with a confirm
  button. Closing, approving and declining save through the same path as the form's Status
  field (any unsaved edits in the form are saved with them). The old "Change product" form
  under Product history is gone; "Undo last change" stays there. Not yet tried on a phone
  against real data.

- 2026-11-01: Entered last digits from 1Password on 111 cards (direct title matches,
  only where the card had none). Leftovers are under Needs Harrison.
- 2026-11-01: Monarch Money cleanup done by hand (no code). Every Monarch credit card account
  is now named with its Cardfolio short name ("biz plat HK8"). 13 accounts were closed on their
  Cardfolio close dates; that includes the stale old-number entries cff HK1, csr HK4 and citi
  premier HK1, whose live accounts are csr HK5, cff HK3 and citi custom cash HK1. 30 cards
  that were already closed in Monarch were renamed too. Newly connected Chase cards were named
  united biz HK1, united biz SL1, cff HK3 and cic HK8 (...3624); the old disconnected cff HK3 entry was closed.
- 2026-10-07: The 1Password last-digits script prints only each card's title and last
  digits (dropped vault, cardholder name, card type and expiry), so its output is safe to paste
  to Claude.
- 2026-10-02: Credit tracking modes (from jjhuang22's "Hide from Credits" PR #2, extended).
  Each credit in Settings is Track + remind, Track quietly, Always used (recurring charges like
  digital entertainment: counted as used every period, shown last with dashed checks, tapping
  explains instead of unticking; a partial amount recorded for a period still takes precedence)
  or Not using (like Oura: hidden from Credits, the card drawer, To do, notifications and
  exports, with history kept). Remind is kept while not tracked, so switching back restores it.
  New `credits.mode` column (`20261002000001_credit_modes.sql`).

- 2026-10-01: The annual fee review skips the year a card is upgraded or downgraded around its
  anniversary (during the review window or up to 60 days before it opens), since that's the
  keep-or-close decision made. It still follows the account's approval anniversary and returns
  the next year. Biz plat HK7 → biz green HK4 (Sep 30) no longer shows a review.
- 2026-10-01: Phones can't zoom the app any more (like a native app): the viewport sets
  `maximum-scale=1, user-scalable=no` (which also stops iOS zooming into focused fields),
  `NoZoom` blocks iOS pinch gestures on touch screens, and `touch-action: manipulation` turns
  off double-tap zoom. Desktop browser zoom still works.
- 2026-09-30: Removed agent (MCP) access for now; see the parked item under Agents. Kept the
  all-or-nothing `cardfolio_*` write functions the app uses. Also removed unused code: the
  Tailwind build setup (never imported), `pushConfigured()`, and exports only used in their
  own file.
- 2026-09-30: Agents can update Cardfolio. `/api/mcp` is an MCP server with tools to read
  cards and card types and to add cards, approve/decline/close them, record upgrades and
  downgrades (and undo them), mark bonuses earned and record credit uses. Keys come from
  Settings → Agents (hash stored; revocable). Every agent write is in `change_log` and shown in
  Settings, and a repeated `source` is skipped. New cards, product changes/undo and credit uses
  now run as single Postgres transactions (`cardfolio_*` functions) for the app too. Tested
  against a local Postgres + PostgREST with a copy of the data (agent flows and the app's own
  credit toggle, add card, product change and undo). Docs: `docs/agents.md`.
- 2026-09-30: Made Cardfolio set-up-able by others. README has a "Set up your own copy"
  guide (fork, Supabase, auth URLs/email, env, first cards, Vercel), the sheet import is
  marked optional, and owner-only notes are trimmed. An empty household shows a "Get started"
  panel (add a cardholder, add cards, add credits) instead of an empty table; "+ Add card"
  opens Settings → Cardholders until there's a cardholder, and saving a card without one
  explains why. `supabase/config.toml` no longer points at the old workers.dev URL. All
  migrations were checked on an empty Postgres; the Supabase/Vercel steps themselves haven't
  been run end to end from a fresh fork.
- 2026-09-30: Credit to-dos (and push reminders) no longer count cards that closed or changed
  product earlier in the period. Biz plat SL3, downgraded to biz green on Jul 2, kept a
  "Hilton $50 on biz plat: 1 card left" to-do even though the Credits tab hides that row.
- 2026-09-30: Cleaned up Settings. Card types with credits come first, and ones with no open
  cards or credits hide behind "Show N card types". Each card type opens into its fields plus
  a "Credits" list, with two-line credit rows and a $ prefix on amounts. The new-credit row has
  its own Remind box. "Review reminders" is now "Review rules" and "Reminders" is now
  "Notifications". Cardholder names can be edited. Blurring an unchanged field no longer
  writes, zero amounts or blank names revert, and "Sure?" on Delete resets after 4 seconds.
  Add credit, add cardholder and invite keep what you typed when the save fails and ignore
  repeat presses (`write()` now resolves to whether it saved). This closes the Settings-drafts
  review follow-up.
- 2026-09-29: Released the code-organization review (`review/code-organization-ui-consistency`):
  one shared card-status module for Cards and Credits (`app/lib/presentation/`), shared card
  identity with last digits on desktop too, a separate to-do component, dialog focus/Escape
  handling and scroll lock, empty Credits search state, and "To do" wording in Settings.
  Amended on merge: kept the violet "kept" tone, neutral fee-soon tags, "Nd left" bonus
  wording, and "renewed/renews" instead of "fee anniversary" for reviews.

- 2026-09-29: Credits tab hides closed cards and earlier products ("Show closed cards" at the
  bottom); biz plat Hilton now sits left of Wireless; added the Amex Platinum credits.

- 2026-09-29: Cards kept open past their first annual fee (over a year old, not in a review
  window) get a light violet shade and a "Kept · $695 fee May 2027" tag; filter them from the
  color key ("kept with a fee").

- 2026-09-29: The card drawer reloads after a product change or undo, so its form shows the
  new card type, fee and number (before, pressing Save could write the old product back).

- 2026-09-29: Date fields on iPhone match the other fields (left-aligned, same height and width).
- 2026-09-29: Cards tab color-coding: red rows to decide (keep or close, missed bonus), amber
  bonuses in progress, blue pending; the color key above the list filters to each. Bonuses
  always show as a pill (green once earned). Opened date is bold on every row. The to-do list
  now sits above the tabs.

- 2026-09-29: UI revamp: two tabs, Cards (every account, newest first; table on desktop,
  tiles on phones; closed & declined behind a toggle) and Credits (the checkbox grids only).
  A to-do list (credits, reviews, bonuses, pending applications) sits at the top of both.
  The per-person filter is gone; the cardholder cards are stats only.

- 2026-09-29: Card labels use cardholder initials like 1Password ("biz plat HK7", "csr SL1");
  initials are editable in Settings → Cardholders and inferred from the sheet on import.

- 2026-09-29: Claude can sign in to production as `devtest068@gmail.com` (member) to test;
  see AGENTS.md → Testing on production.

- 2026-09-29: Sign-in emails sent from cardfolio@harrisonku.com via Resend, with the 6-digit code.
- 2026-09-29: Short card names (the sheet abbreviations, overridable in Settings) in tables,
  tags, due list, toasts and notifications; fixed the phone Timeline where a long product
  history made the pinned first column cover the table.

- 2026-09-29: Rebuilt as a one-page app with product histories and per-card credits;
  imported the sheet; deployed to cardfolio.harrisonku.com.
- 2026-09-29: Push reminders (daily cron), sign-in code entry, 1Password last-digits script.
