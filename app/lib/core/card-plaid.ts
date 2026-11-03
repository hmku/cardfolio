/**
 * What Plaid data adds to the card pages: balances and payments due, welcome-bonus spend
 * progress, suggested statement-credit uses and annual fee postings. Pure functions over
 * plain rows; the browser loads them (app/lib/finance-data.ts) and the reminder cron uses the
 * payment part. Every function copes with a card that isn't linked to Plaid (it returns null
 * or nothing).
 *
 * Amounts are integer cents with Cardfolio's transaction sign: positive = money into the card
 * account (payments, refunds, statement credits), negative = purchases and fees. Balances are
 * as Plaid reports them (a card's current balance is the positive amount owed).
 */
import { creditPeriod, creditState, eligibleHoldings, type Period } from "./credits.ts";
import { addDays, daysBetween, isoDate, parseDate } from "./dates.ts";
import type { Account, Credit, Holding, Portfolio } from "./model.ts";
import { bonusStatus } from "./stats.ts";

/** One transaction on a linked card, with only what these features need. */
export type CardTransaction = {
  id: number;
  plaidAccountId: number;
  date: string;
  amountCents: number;
  name: string;
  merchantName: string | null;
  pending: boolean;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
};

/** A Plaid credit card linked to a Cardfolio account (plaid_accounts.account_id). */
export type LinkedCard = {
  plaidAccountId: number;
  accountId: number;
  currentCents: number | null;
  limitCents: number | null;
  statementCents: number | null;
  statementDate: string | null;
  minimumCents: number | null;
  dueDate: string | null;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
  overdue: boolean | null;
  /** When Plaid last reported balances (ISO timestamp). */
  updatedAt: string | null;
  /** False while Plaid is still fetching the login's older history; null if unknown. */
  historyComplete: boolean | null;
  /** Date of the oldest transaction Cardfolio has for this card (null: none; undefined: not loaded). */
  firstTransactionDate?: string | null;
};

export type CardPlaidData = { cards: LinkedCard[]; transactions: CardTransaction[] };

const normalize = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const textOf = (transaction: Pick<CardTransaction, "name" | "merchantName">) => normalize(`${transaction.merchantName || ""} ${transaction.name}`);
/** Whole-word (or whole-phrase) match on normalized text. */
const hasPhrase = (text: string, phrase: string) => text.includes(` ${normalize(phrase).trim()} `);

/** The Plaid card linked to a Cardfolio account, if any (the first one if several are). */
export function linkedCard(data: CardPlaidData, accountId: number) {
  return data.cards.find((card) => card.accountId === accountId) || null;
}

// ---------- payments ----------

/** How many days before the due date an unpaid statement shows in To do. */
export const PAYMENT_WINDOW_DAYS = 5;
/** Ignore leftovers under $1 (rounding, small adjustments). */
const PAYMENT_TOLERANCE_CENTS = 100;

/** A payment to the card: money in that Plaid categorizes as a loan payment or that says "payment". */
export function isCardPayment(transaction: CardTransaction) {
  if (transaction.amountCents <= 0) return false;
  if ((transaction.categoryDetailed || "").startsWith("LOAN_PAYMENTS") || transaction.categoryPrimary === "LOAN_PAYMENTS") return true;
  const text = textOf(transaction);
  return ["payment", "autopay", "autopymt", "pymt", "thank you"].some((word) => hasPhrase(text, word));
}

export type PaymentStatus = {
  balanceCents: number | null;
  limitCents: number | null;
  statementCents: number | null;
  statementDate: string | null;
  minimumCents: number | null;
  dueDate: string | null;
  /** Days until the due date (negative once it's passed); null without a due date. */
  daysLeft: number | null;
  /** Paid since the statement closed: the larger of Plaid's last payment and payment transactions. */
  paidCents: number;
  /** What's left of the statement balance. */
  remainingCents: number;
  overdue: boolean;
  /** An unpaid statement balance due within PAYMENT_WINDOW_DAYS (or a few days past). */
  needsPayment: boolean;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
};

export function paymentStatus(card: LinkedCard, transactions: CardTransaction[], today: Date): PaymentStatus {
  const statementDate = card.statementDate;
  const fromTransactions = statementDate
    ? transactions.filter((item) => item.plaidAccountId === card.plaidAccountId && item.date > statementDate && isCardPayment(item))
      .reduce((total, item) => total + item.amountCents, 0)
    : 0;
  const fromLiabilities = statementDate && card.lastPaymentDate && card.lastPaymentDate > statementDate ? card.lastPaymentCents || 0 : 0;
  const paidCents = Math.max(fromTransactions, fromLiabilities);
  const statementCents = card.statementCents;
  const remainingCents = statementCents && statementCents > 0 ? Math.max(0, statementCents - paidCents) : 0;
  const due = parseDate(card.dueDate);
  const daysLeft = due ? daysBetween(today, due) : null;
  // Plaid's is_overdue only clears on the next liabilities refresh; once the minimum is paid, stop calling it overdue.
  const overdue = card.overdue === true && paidCents < Math.max(card.minimumCents ?? 0, PAYMENT_TOLERANCE_CENTS);
  const needsPayment = !overdue && remainingCents >= PAYMENT_TOLERANCE_CENTS && daysLeft !== null && daysLeft <= PAYMENT_WINDOW_DAYS && daysLeft >= -3;
  return {
    balanceCents: card.currentCents, limitCents: card.limitCents, statementCents, statementDate,
    minimumCents: card.minimumCents, dueDate: card.dueDate, daysLeft, paidCents, remainingCents, overdue, needsPayment,
    lastPaymentCents: card.lastPaymentCents, lastPaymentDate: card.lastPaymentDate,
  };
}

/** Linked open cards with a payment to make soon or overdue, for To do and reminders. */
export function paymentsDue(portfolio: Portfolio, data: CardPlaidData, today: Date) {
  const result: { account: Account; payment: PaymentStatus }[] = [];
  const seen = new Set<number>();
  for (const card of data.cards) {
    const account = portfolio.account(card.accountId);
    if (!account || account.status !== "open" || seen.has(account.id)) continue;
    seen.add(account.id);
    const payment = paymentStatus(card, data.transactions, today);
    if (payment.overdue || payment.needsPayment) result.push({ account, payment });
  }
  return result;
}

// ---------- welcome bonus spend ----------

const NOT_SPEND_CATEGORIES = new Set(["BANK_FEES", "TRANSFER_OUT", "TRANSFER_IN", "LOAN_PAYMENTS"]);
const NOT_SPEND_PHRASES = ["annual fee", "membership fee", "interest charge", "late fee", "late payment fee", "cash advance", "balance transfer", "foreign transaction fee"];

/**
 * Whether a transaction counts toward a welcome bonus: a posted purchase (money out), not a
 * fee, interest, cash advance or transfer. Pending purchases are counted separately because
 * they can still change or drop off; refunds and statement credits aren't subtracted.
 */
export function isBonusSpend(transaction: CardTransaction) {
  if (transaction.amountCents >= 0) return false;
  if (transaction.categoryPrimary && NOT_SPEND_CATEGORIES.has(transaction.categoryPrimary)) return false;
  const text = textOf(transaction);
  return !NOT_SPEND_PHRASES.some((phrase) => hasPhrase(text, phrase));
}

export type BonusProgress = {
  targetCents: number;
  /** Posted purchases from approval through the deadline. */
  spentCents: number;
  pendingCents: number;
  /** Still to spend (0 once the target is met). */
  leftCents: number;
  deadline: Date;
  daysLeft: number;
  met: boolean;
  /**
   * Set when Plaid's history might not reach back to approval: the date the card's
   * transactions start (or "none" when there are none yet), or "loading" while Plaid is
   * still fetching older history.
   */
  historyGap: string | "none" | "loading" | null;
};

/** Grace before warning that history starts after approval (a first purchase can take a while). */
const HISTORY_GRACE_DAYS = 14;

/** Bonus spend so far on a linked card, or null without a linked card or an open spend target. */
export function bonusProgress(account: Account, card: LinkedCard | null, transactions: CardTransaction[], today: Date): BonusProgress | null {
  const status = bonusStatus(account, today);
  const targetCents = account.bonus?.spendCents || 0;
  if (!status || !card || !targetCents || !account.approvedOn) return null;
  const from = account.approvedOn;
  const to = isoDate(status.deadline);
  let spentCents = 0;
  let pendingCents = 0;
  for (const item of transactions) {
    if (item.plaidAccountId !== card.plaidAccountId || item.date < from || item.date > to || !isBonusSpend(item)) continue;
    if (item.pending) pendingCents -= item.amountCents;
    else spentCents -= item.amountCents;
  }
  let historyGap: BonusProgress["historyGap"] = null;
  if (card.historyComplete === false) historyGap = "loading";
  else if (card.firstTransactionDate === null) historyGap = "none";
  else if (card.firstTransactionDate && card.firstTransactionDate > isoDate(addDays(parseDate(from)!, HISTORY_GRACE_DAYS))) historyGap = card.firstTransactionDate;
  return {
    targetCents, spentCents, pendingCents, leftCents: Math.max(0, targetCents - spentCents),
    deadline: status.deadline, daysLeft: status.daysLeft, met: spentCents >= targetCents, historyGap,
  };
}

// ---------- annual fees ----------

const FEE_PHRASES = ["annual fee", "membership fee", "annual membership"];
const NOT_ANNUAL_FEE = ["foreign transaction", "late fee", "late payment", "returned payment"];

export function isAnnualFee(transaction: Pick<CardTransaction, "name" | "merchantName">) {
  const text = textOf(transaction);
  return FEE_PHRASES.some((phrase) => hasPhrase(text, phrase)) && !NOT_ANNUAL_FEE.some((phrase) => hasPhrase(text, phrase));
}

export type FeePosting = { date: string; amountCents: number; pending: boolean; refundedOn: string | null };

/** How far back to look for the latest annual fee posting. */
export const FEE_LOOKBACK_DAYS = 400;

/** The latest annual fee charged on a linked card in the last ~13 months, with a later refund if any. */
export function latestFeePosting(card: LinkedCard | null, transactions: CardTransaction[], today: Date): FeePosting | null {
  if (!card) return null;
  const since = isoDate(addDays(today, -FEE_LOOKBACK_DAYS));
  const fees = transactions.filter((item) => item.plaidAccountId === card.plaidAccountId && item.date >= since && isAnnualFee(item))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  const charge = fees.filter((item) => item.amountCents < 0).pop();
  if (!charge) return null;
  const refund = fees.find((item) => item.amountCents > 0 && item.date >= charge.date && Math.abs(item.amountCents + charge.amountCents) <= PAYMENT_TOLERANCE_CENTS);
  return { date: charge.date, amountCents: -charge.amountCents, pending: charge.pending, refundedOn: refund?.date ?? null };
}

// ---------- statement credit suggestions ----------

/**
 * Keywords for credits whose bank description doesn't simply repeat the credit's name. Each
 * entry applies when the credit's name matches `test`: a transaction matches when its merchant
 * or description contains any of `phrases` and none of `unless`. `exact` lists whole
 * descriptions that are the credit itself even without a "credit" word (Amex posts the
 * Business Platinum Hilton credit as just "Hilton").
 */
const CREDIT_ALIASES: { test: RegExp; phrases: string[]; unless?: string[]; exact?: string[] }[] = [
  { test: /uber\s*one/i, phrases: ["uber one"] },
  { test: /uber/i, phrases: ["uber"], unless: ["uber one"] },
  { test: /digital\s+entertainment|entertainment/i, phrases: ["digital entertainment", "entertainment credit"] },
  { test: /airline/i, phrases: ["airline"] },
  // Amex posts the Platinum's Fine Hotels credit as "Platinum Hotel Credit" (and older ones as
  // "AMEX Fine Hotels andAmexTravel.com").
  { test: /fine\s+hotels|\bfhr\b|hotel\s+collection/i, phrases: ["fine hotels", "fhr", "hotel collection", "amex travel hotel", "hotel credit"] },
  { test: /hilton/i, phrases: ["hilton"], exact: ["hilton"] },
  { test: /walmart/i, phrases: ["walmart"] },
  { test: /clear/i, phrases: ["clear", "clearme", "clear plus"] },
  { test: /global\s+entry|tsa|precheck/i, phrases: ["global entry", "tsa", "precheck", "trusted traveler"] },
  { test: /wireless/i, phrases: ["wireless"] },
  { test: /dining/i, phrases: ["dining credit", "grubhub", "cheesecake factory", "goldbelly", "wine com", "five guys"] },
  { test: /saks/i, phrases: ["saks"] },
];

/** Words that don't identify a credit on their own. */
const GENERIC_WORDS = new Set(["credit", "credits", "statement", "amex", "american", "express", "the", "and", "of", "for", "on", "a", "monthly", "quarterly", "annual", "yearly", "benefit", "bonus", "purchase", "purchases"]);

/** Words in a description that say it's a statement credit rather than a merchant refund. */
const CREDIT_SIGNALS = ["credit", "amex", "reimbursement", "statement credit", "offer", "benefit"];

/**
 * The keyword phrases for a credit: a curated alias when one fits the name (Uber, airline,
 * digital entertainment...), otherwise the credit's own name without generic words
 * ("Dell" → "dell", "lululemon credit" → "lululemon", "Hilton" → "hilton").
 */
export function creditKeywords(credit: Pick<Credit, "name">): { phrases: string[]; unless: string[]; exact: string[] } {
  const alias = CREDIT_ALIASES.find((entry) => entry.test.test(credit.name));
  if (alias) return { phrases: alias.phrases, unless: alias.unless || [], exact: alias.exact || [] };
  const words = normalize(credit.name).trim().split(" ").filter((word) => word && !GENERIC_WORDS.has(word) && !/^\d+$/.test(word));
  return { phrases: words.length ? [words.join(" ")] : [], unless: [], exact: [] };
}

/** Whether a matching posting reads as a statement credit (not possibly an ordinary refund). */
function looksLikeCredit(credit: Pick<Credit, "name">, transaction: Pick<CardTransaction, "name" | "merchantName">) {
  const text = textOf(transaction);
  return CREDIT_SIGNALS.some((signal) => hasPhrase(text, signal))
    || creditKeywords(credit).exact.some((phrase) => normalize(transaction.name) === normalize(phrase));
}

/** How closely a transaction's text matches a credit: the longest matching phrase, or 0. */
export function creditMatchScore(credit: Pick<Credit, "name">, transaction: Pick<CardTransaction, "name" | "merchantName">) {
  const { phrases, unless } = creditKeywords(credit);
  const text = textOf(transaction);
  if (unless.some((phrase) => hasPhrase(text, phrase))) return 0;
  return phrases.filter((phrase) => hasPhrase(text, phrase)).reduce((best, phrase) => Math.max(best, phrase.length), 0);
}

/** A statement credit is never much bigger than the credit itself; bigger is a refund. */
const MAX_AMOUNT_RATIO = 2.5;

export type CreditSuggestion = {
  /** Stable id for dismissals: transaction and credit. */
  key: string;
  transaction: CardTransaction;
  credit: Credit;
  holding: Holding;
  period: Period;
  /** What the credit's use would be after accepting (existing use plus this posting, capped). */
  recordCents: number;
  /** No "credit"/"Amex"-style word in the description: might be an ordinary refund. */
  maybeRefund: boolean;
};

export const suggestionKey = (transactionId: number, creditId: number) => `${transactionId}:${creditId}`;

/**
 * Suggested credit uses: posted money-in transactions on a linked card whose description
 * matches one of the card's tracked credits (not "always used" or "not using"), dated in the credit's current period, no bigger than
 * MAX_AMOUNT_RATIO × the credit, on a credit not already used up this period. Each
 * transaction suggests at most one credit (the best text match). `handled` holds keys a
 * person dismissed or accepted; a transaction is also skipped when a Plaid-sourced use in
 * that period is dated on or after it (it was accepted on another device).
 */
export function creditSuggestions(portfolio: Portfolio, data: CardPlaidData, today: Date, handled: ReadonlySet<string> = new Set()): CreditSuggestion[] {
  const suggestions: CreditSuggestion[] = [];
  const cards = new Map(data.cards.map((card) => [card.plaidAccountId, card]));
  const eligible = new Map<number, Set<number>>();
  const eligibleFor = (credit: Credit) => {
    if (!eligible.has(credit.id)) eligible.set(credit.id, new Set(eligibleHoldings(portfolio, credit, today).map((holding) => holding.id)));
    return eligible.get(credit.id)!;
  };
  // Running totals so two postings for one credit don't both claim the full amount.
  const pendingUse = new Map<string, number>();
  const transactions = [...data.transactions].sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  for (const transaction of transactions) {
    if (transaction.amountCents <= 0 || transaction.pending || isCardPayment(transaction) || isAnnualFee(transaction)) continue;
    const card = cards.get(transaction.plaidAccountId);
    if (!card) continue;
    const date = parseDate(transaction.date);
    if (!date) continue;
    // Newest match: on a product-change day the old holding ends and the new one starts on that date.
    const holding = portfolio.holdingsOf(card.accountId).findLast((item) => {
      const end = portfolio.holdingEnd(item);
      return item.startedOn <= transaction.date && (!end || end >= transaction.date);
    });
    if (!holding) continue;
    const account = portfolio.account(holding.accountId);
    let best: { credit: Credit; score: number } | null = null;
    for (const credit of portfolio.credits) {
      if (credit.productId !== holding.productId || credit.mode !== "track") continue;
      if (transaction.amountCents > credit.amountCents * MAX_AMOUNT_RATIO) continue;
      const score = creditMatchScore(credit, transaction);
      if (score > (best?.score ?? 0)) best = { credit, score };
    }
    // A dismissed match stays dismissed; the transaction doesn't fall through to another credit.
    if (!best || handled.has(suggestionKey(transaction.id, best.credit.id))) continue;
    const { credit } = best;
    if (!eligibleFor(credit).has(holding.id)) continue;
    const state = creditState(portfolio, credit, holding, today);
    if (state.kind === "off") continue;
    // Only the current period: that's what the grid shows and what a tap records.
    const period = creditPeriod(credit.cadence, date, account?.approvedOn);
    if (period.key !== state.period.key) continue;
    if (state.uses.some((use) => use.source === "plaid" && use.usedOn && use.usedOn >= transaction.date)) continue;
    const useKey = `${credit.id}:${holding.id}:${period.key}`;
    const usedCents = pendingUse.get(useKey) ?? state.usedCents;
    if (usedCents >= credit.amountCents) continue;
    const recordCents = Math.min(credit.amountCents, usedCents + transaction.amountCents);
    pendingUse.set(useKey, recordCents);
    suggestions.push({
      key: suggestionKey(transaction.id, credit.id), transaction, credit, holding, period: state.period, recordCents,
      maybeRefund: !looksLikeCredit(credit, transaction),
    });
  }
  return suggestions;
}

// ---------- everything for one card ----------

export type CardPlaidSummary = {
  card: LinkedCard;
  payment: PaymentStatus;
  bonus: BonusProgress | null;
  fee: FeePosting | null;
  suggestions: CreditSuggestion[];
};

export type CardPlaidView = {
  byAccount: Map<number, CardPlaidSummary>;
  suggestions: CreditSuggestion[];
  payments: { account: Account; payment: PaymentStatus }[];
};

export function summarizeCardPlaid(portfolio: Portfolio, data: CardPlaidData, today: Date, handled: ReadonlySet<string> = new Set()): CardPlaidView {
  const suggestions = creditSuggestions(portfolio, data, today, handled);
  const byAccount = new Map<number, CardPlaidSummary>();
  for (const card of data.cards) {
    const account = portfolio.account(card.accountId);
    if (!account || byAccount.has(account.id)) continue;
    byAccount.set(account.id, {
      card,
      payment: paymentStatus(card, data.transactions, today),
      bonus: bonusProgress(account, card, data.transactions, today),
      fee: latestFeePosting(card, data.transactions, today),
      suggestions: suggestions.filter((suggestion) => suggestion.holding.accountId === account.id),
    });
  }
  return { byAccount, suggestions, payments: paymentsDue(portfolio, data, today) };
}
