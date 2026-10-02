# Cardfolio to-do

Open items, newest decisions first within each section. Check items off (`- [x]`) when
done and move them to **Done** with the date.

## Needs Harrison

- [ ] **Turn on reminders** on each device (Settings → Reminders → Turn on, then Send a test).
      On iPhone, add the site to the home screen first and turn it on from there. Sophia too.
- [ ] **Card last digits from 1Password**: `brew install 1password-cli jq`, enable
      1Password → Settings → Developer → "Integrate with 1Password CLI", run
      `bash scripts/1password-last-digits.sh > card-last-digits.csv`, and paste the output to
      Claude to match against accounts.
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

- [ ] Plaid: connect card accounts, detect statement credits, track bonus spend and fee
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
