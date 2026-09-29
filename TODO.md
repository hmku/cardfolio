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
      Amex site itself couldn't be reached): Hotel $300/half, Resy $100/qtr, lululemon $75/qtr,
      Airline fee $200/yr, Digital entertainment $25/mo, Uber Cash $15/mo, Uber One $120/yr,
      Walmart+ $12.95/mo, CLEAR $209/yr, Oura $200/yr, Equinox $300/yr. Delete any you won't
      use in Settings → Card types, or mark them not enrolled per card. Uber Cash is $35 in
      December; the app can't vary a monthly amount yet, so log the extra $20 as a partial use.
- [ ] Stop editing the tracker, credits and stats tabs of the Google Sheet once the app is
      the source of truth.

## Optional setup

- [ ] **Google Sheet copy**: create a Google Cloud service account with the Sheets API,
      share an empty spreadsheet with it, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` and `CARDFOLIO_EXPORT_SPREADSHEET_ID` in Vercel
      (see README).

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
