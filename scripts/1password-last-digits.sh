#!/usr/bin/env bash
# Prints the title and last digits of every credit card saved in 1Password, as CSV, so they
# can be matched to Cardfolio cards. The trimming happens here, on your machine: full card
# numbers, CVVs, PINs, expiry dates and cardholder names are never printed.
#
# Needs the 1Password CLI (brew install 1password-cli) with "Integrate with 1Password CLI"
# turned on in the 1Password app (Settings → Developer), plus jq (brew install jq).
#
#   bash scripts/1password-last-digits.sh > card-last-digits.csv
set -euo pipefail

command -v op >/dev/null || { echo "Install the 1Password CLI first: brew install 1password-cli" >&2; exit 1; }
command -v jq >/dev/null || { echo "Install jq first: brew install jq" >&2; exit 1; }

echo "title,last_digits"
op item list --categories "Credit Card" --format json \
  | op item get - --format json \
  | jq -rs '
      .[] as $item
      | ($item.fields // []) as $fields
      | def field($id): ($fields | map(select(.id == $id)) | first | .value // "");
        (field("ccnum") | gsub("[^0-9]"; "")) as $number
      | [
          $item.title,
          # Amex numbers are 15 digits and their statements show 5; everyone else shows 4.
          (if ($number | test("^3[47]")) then $number[-5:] else $number[-4:] end)
        ]
      | @csv'
