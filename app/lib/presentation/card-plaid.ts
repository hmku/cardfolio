import type { BonusProgress, FeePosting, PaymentStatus } from "../core/card-plaid.ts";
import { money, shortDate } from "./format.ts";

/** "$1,234 due Nov 20", "Statement paid", "Overdue · $40 minimum", or null with no statement. */
export function paymentText(payment: PaymentStatus) {
  if (payment.overdue) return `Overdue${payment.minimumCents ? ` · ${money(payment.minimumCents)} minimum` : ""}`;
  if (!payment.statementCents || payment.statementCents <= 0) return null;
  if (payment.remainingCents < 100) return "Statement paid";
  return `${money(payment.remainingCents)} due ${payment.dueDate ? shortDate(payment.dueDate) : "soon"}`;
}

/** "$2,345 balance" (null when Plaid hasn't reported one). */
export function balanceText(payment: PaymentStatus) {
  return payment.balanceCents === null ? null : `${money(payment.balanceCents)} balance`;
}

const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;

/** "$3,210 of $5,000 spent, 48 days left" (plus pending and a met note). */
export function bonusProgressText(progress: BonusProgress) {
  const pending = progress.pendingCents > 0 ? ` (+${money(progress.pendingCents)} pending)` : "";
  if (progress.met) return `${money(progress.spentCents)} of ${money(progress.targetCents)} spent${pending}: target met`;
  const left = progress.daysLeft < 0 ? `deadline passed` : progress.daysLeft === 0 ? "last day" : `${days(progress.daysLeft)} left`;
  return `${money(progress.spentCents)} of ${money(progress.targetCents)} spent${pending}, ${left}`;
}

/** Why the spend total might be low, or null. */
export function bonusHistoryWarning(progress: BonusProgress) {
  if (!progress.historyGap) return null;
  if (progress.historyGap === "loading") return "Plaid is still loading this card's older transactions, so the total may be low.";
  if (progress.historyGap === "none") return "No transactions from Plaid for this card yet.";
  return `Plaid's transactions for this card start ${shortDate(progress.historyGap)}, so earlier spend isn't counted.`;
}

/** "fee posted Oct 3: $695" (with "pending" or "refunded Oct 20"). */
export function feePostingText(fee: FeePosting) {
  return `fee ${fee.pending ? "pending" : "posted"} ${shortDate(fee.date)}: ${money(fee.amountCents)}${fee.refundedOn ? `, refunded ${shortDate(fee.refundedOn)}` : ""}`;
}
