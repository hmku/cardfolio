import { CADENCE_LABELS, creditSummary, eligibleHoldings, periodFor } from "./credits.ts";
import { isoDate } from "./dates.ts";
import { bonusLabel, centsToDollars, type Portfolio } from "./model.ts";
import { personStats } from "./stats.ts";

export type ExportTables = { tracker: (string | number)[][]; credits: (string | number)[][]; stats: (string | number)[][] };

const VIA: Record<string, string> = { applied: "applied", referral: "referral", nll_offer: "NLL offer", product_change: "product change", other: "other" };

/** Sheet-shaped tables: one tracker row per product an account has held, like the original sheet. */
export function exportTables(portfolio: Portfolio, today: Date): ExportTables {
  const tracker: ExportTables["tracker"] = [[
    "who", "card", "card type", "kind", "card #", "last digits", "applied", "approved", "opened how", "bonus", "spend", "months",
    "bonus earned", "annual fee", "product started", "product ended", "account status", "account closed", "note",
  ]];
  const accounts = [...portfolio.accounts].sort((left, right) => String(left.appliedOn || left.approvedOn).localeCompare(String(right.appliedOn || right.approvedOn)) || left.id - right.id);
  for (const account of accounts) {
    const holdings = portfolio.holdingsOf(account.id);
    holdings.forEach((holding, index) => {
      const product = portfolio.product(holding.productId);
      const first = index === 0;
      tracker.push([
        portfolio.person(account.personId)?.name || "",
        product?.slug || "",
        product?.name || "",
        product?.kind || "",
        holding.number ?? "",
        holding.last4 || "",
        first ? account.appliedOn || "" : "",
        first ? account.approvedOn || "" : holding.startedOn,
        first ? VIA[account.openedVia] : holding.change,
        first && account.bonus ? bonusLabel(account.bonus) : "",
        first && account.bonus?.spendCents ? centsToDollars(account.bonus.spendCents) : "",
        first && account.bonus ? account.bonus.months : "",
        first && account.bonus ? (account.bonusEarned ? "TRUE" : "FALSE") : "",
        centsToDollars(holding.annualFeeCents),
        holding.startedOn,
        portfolio.holdingEnd(holding) || "",
        account.status,
        account.closedOn && (account.status === "closed" || account.status === "declined") ? account.closedOn : "",
        index === holdings.length - 1 ? account.note || "" : "",
      ]);
    });
  }

  const credits: ExportTables["credits"] = [["card type", "credit", "amount", "frequency", "period", "used", "tracked cards", "left this period"]];
  for (const credit of portfolio.credits) {
    if (credit.mode === "skip") continue;
    const holdings = eligibleHoldings(portfolio, credit, today);
    const summary = creditSummary(portfolio, credit, holdings, today);
    const period = periodFor(portfolio, credit, null, today);
    credits.push([
      portfolio.product(credit.productId)?.name || "",
      credit.name,
      centsToDollars(credit.amountCents),
      CADENCE_LABELS[credit.cadence],
      credit.cadence === "card_year" ? "card year" : period.label,
      summary.used,
      summary.enrolled,
      centsToDollars(summary.remainingCents),
    ]);
  }

  const stats: ExportTables["stats"] = [["person", "open", "closed", "declined", "pending", "5/24 count", "next 5/24 drop"]];
  for (const person of portfolio.people) {
    const row = personStats(portfolio, person.id, today);
    stats.push([person.name, row.open, row.closed, row.declined, row.pending, row.fiveTwentyFour.count, row.fiveTwentyFour.nextDrop ? isoDate(row.fiveTwentyFour.nextDrop) : ""]);
  }
  return { tracker, credits, stats };
}

export function toCsv(rows: (string | number)[][]) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\n");
}
