# Cardfolio to-do

Open items, newest decisions first within each section. Check items off (`- [x]`) when
done and move them to **Done** with the date.

## Needs Harrison

- [ ] **Send sign-in emails from cardfolio@harrisonku.com** (so the email can include the
      6-digit code; Supabase only allows editing the template with custom SMTP)
  1. resend.com → sign up → Domains → Add `harrisonku.com`.
  2. Vercel → Domains → harrisonku.com → DNS Records → add each record Resend shows
     (usually TXT `resend._domainkey`, MX + TXT for `send`). Then Verify in Resend.
  3. Resend → API Keys → Create (Sending access, harrisonku.com only). Copy the `re_…` key.
  4. Supabase → Authentication → Emails → Set up SMTP: host `smtp.resend.com`, port `465`,
     username `resend`, password = the key, sender `cardfolio@harrisonku.com`, name `Cardfolio`.
  5. Replace the **Magic Link** template body with:
     ```html
     <h2>Sign in to Cardfolio</h2>
     <p>Your code: <strong>{{ .Token }}</strong></p>
     <p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a>.</p>
     ```
     Optional subject: "Your Cardfolio sign-in code".
  6. Sign out and back in to check the email arrives with the code.
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

- [ ] **Let Claude sign in to test**: invite e.g. `harrisonku3+cardfolio@gmail.com` from
      Settings, connect a Gmail connector so the sign-in email can be read, and allow
      `cardfolio.harrisonku.com` and `ylrkwnqrmuxlzouziabz.supabase.co` in the Claude Code
      environment's network settings. The account has full edit access to real data.
- [ ] **Google Sheet copy**: create a Google Cloud service account with the Sheets API,
      share an empty spreadsheet with it, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` and `CARDFOLIO_EXPORT_SPREADSHEET_ID` in Vercel
      (see README).

## Ideas / later

- [ ] Plaid: connect card accounts, detect statement credits, track bonus spend and fee
      postings (`credit_uses.source = 'plaid'` is already in the schema). Needs a Plaid
      production account.
- [ ] Credit history view: past periods per card (e.g. last year's Dell credit on every Biz Plat).
- [ ] Native mobile app (Expo) reusing `app/lib/core`, only if the home-screen web app
      feels limiting.
- [ ] Drop the `legacy_*` tables once nothing from the v1 app is needed.
- [ ] Supabase security advisor: `is_cardfolio_member` / `is_cardfolio_owner` are callable
      via RPC (they only reveal the caller's own membership); consider revoking `anon`.

## Done

- 2026-09-29: Rebuilt as a one-page app with product histories and per-card credits;
  imported the sheet; deployed to cardfolio.harrisonku.com.
- 2026-09-29: Push reminders (daily cron), sign-in code entry, 1Password last-digits script.
