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
- [ ] Stop editing the tracker, credits and stats tabs of the Google Sheet once the app is
      the source of truth.

## Optional setup

- [ ] **Google Sheet copy**: create a Google Cloud service account with the Sheets API,
      share an empty spreadsheet with it, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` and `CARDFOLIO_EXPORT_SPREADSHEET_ID` in Vercel
      (see README).

## Review follow-ups

- [ ] Review and release `review/code-organization-ui-consistency` after a signed-in
      desktop/phone smoke test in light and dark mode; see `docs/code-review-2026-09-29.md`.
- [ ] Make credit replacement, product changes/undo, and account edits transactional;
      add failure and concurrent-write tests before changing the browser data API.
- [ ] Preserve Settings drafts when a save/invite fails and disable duplicate submissions;
      give async handlers an explicit success/failure contract.
- [ ] Prevent stale portfolio reloads from replacing newer data; clear pending realtime
      reload and sheet-sync timers on cleanup.

## Ideas / later

- [ ] Plaid: connect card accounts, detect statement credits, track bonus spend and fee
      postings (`credit_uses.source = 'plaid'` is already in the schema). Needs a Plaid
      production account. Plaid can't report autopay settings directly, but payments on the
      due-date schedule (often labeled "AUTOPAY") show it; flag cards with a balance due and
      no payment by the due date. It has no opening dates or product-change history.
- [ ] Credit history view: past periods per card (e.g. last year's Dell credit on every Biz Plat).
- [ ] Native mobile app (Expo) reusing `app/lib/core`, only if the home-screen web app
      feels limiting.
- [ ] Drop the `legacy_*` tables once nothing from the v1 app is needed.
- [ ] Supabase security advisor: `is_cardfolio_member` / `is_cardfolio_owner` are callable
      via RPC (they only reveal the caller's own membership); consider revoking `anon`.

## Done

- 2026-09-29: Review branch consolidates card statuses/identity/formatters, separates the
  to-do component, adds stable dialog focus and toast timers, and fixes empty search,
  last-digit visibility, phone wrapping, and stale “Due soon” wording. Regression tests
  and local desktop/phone browser checks added/completed; release is tracked above.


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
