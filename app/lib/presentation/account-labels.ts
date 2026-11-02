/** One name per bank account, used on every finance page (Transactions, Cash flow, Accounts, Investments, Settings). */
import { holdingName, type Portfolio } from "../core/model.ts";
import type { BankAccount } from "../finance-data.ts";

type LabeledAccount = Pick<BankAccount, "cardAccountId" | "institutionName" | "name" | "mask">;

/**
 * A bank account linked to a Cardfolio card is named after the card: "biz plat HK9" for lists,
 * "Amex Business Platinum HK9 ··1001" with `full` (headings, dropdowns, drawers). Other accounts use
 * Plaid's name and last digits: "Plaid Checking ··1234", with the institution in front with `full`
 * ("Chase Plaid Checking ··1234") unless the name already starts with it.
 */
export function bankAccountLabel(account: LabeledAccount | undefined, portfolio: Portfolio, options: { full?: boolean } = {}) {
  if (!account) return options.full ? "Unknown account" : "";
  const mask = account.mask ? ` ··${account.mask}` : "";
  if (account.cardAccountId !== null) {
    const holding = portfolio.current(account.cardAccountId);
    if (holding) return options.full ? `${holdingName(portfolio, holding, true)}${mask}` : holdingName(portfolio, holding);
  }
  const institution = account.institutionName?.trim();
  const withInstitution = options.full && institution && !account.name.toLowerCase().startsWith(institution.toLowerCase());
  return `${withInstitution ? `${institution} ` : ""}${account.name}${mask}`;
}
