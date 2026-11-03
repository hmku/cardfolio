"use client";

import { useRef, useState } from "react";
import type { Portfolio } from "../lib/core/model";
import {
  applyRuleToExisting, saveCategoryRule, updateTransaction,
  type BankAccount, type Category, type CategoryRule, type FinanceContext, type Transaction, type TransactionPatch,
} from "../lib/finance-data";
import { transactionAmount } from "../lib/presentation/finance-format";
import { fullDate } from "../lib/presentation/format";
import { bankAccountLabel } from "../lib/presentation/account-labels";
import { CategoryPicker, categoryLabel } from "./CategoryPicker";
import { Drawer, Tag } from "./ui";
import { errorText } from "../lib/api";

type Props = {
  context: FinanceContext;
  portfolio: Portfolio;
  transaction: Transaction;
  categories: Category[];
  rules: CategoryRule[];
  account: BankAccount | undefined;
  notify: (text: string, error?: boolean) => void;
  onUpdated: (transaction: Transaction) => void;
  /** A rule was added or changed; `transactionsChanged` when it was applied to past transactions. */
  onRulesChanged: (transactionsChanged: boolean) => void;
  onClose: () => void;
};

const SOURCE_LABELS = { manual: "set by hand", rule: "from a rule", plaid: "from Plaid's category" } as const;
const plaidCode = (code: string | null) => (code ? code.toLowerCase().replace(/_/g, " ") : "");

/** One transaction: category, notes, exclude and reviewed, plus "Always categorize … as …". */
export function TransactionDrawer({ context, portfolio, transaction, categories, rules, account, notify, onUpdated, onRulesChanged, onClose }: Props) {
  const [notes, setNotes] = useState(transaction.notes || "");
  // Saves run one after another, so a slower earlier save can't overwrite a later one. Only the
  // checkbox and category saves disable the checkboxes; a notes save (on blur) doesn't block them.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [blocking, setBlocking] = useState(0);
  const sentNotes = useRef(transaction.notes || null);
  const [onlyThisAccount, setOnlyThisAccount] = useState(false);
  const [newRule, setNewRule] = useState<CategoryRule | null>(null);
  const merchant = transaction.merchantName || transaction.name;
  const field = transaction.merchantName ? "merchant" as const : "name" as const;
  const category = transaction.categoryId === null ? null : categories.find((item) => item.id === transaction.categoryId) ?? null;
  const existingRule = rules.find((rule) => rule.matchText.trim().toLowerCase() === merchant.trim().toLowerCase() && rule.matchField === field
    && (rule.plaidAccountId === null || rule.plaidAccountId === transaction.plaidAccountId));

  function save(patch: TransactionPatch, { block = true } = {}) {
    if (block) setBlocking((count) => count + 1);
    queue.current = queue.current.then(async () => {
      try {
        onUpdated(await updateTransaction(context, transaction.id, patch));
      } catch (reason) {
        notify(errorText(reason, "Couldn't save the transaction."), true);
      } finally {
        if (block) setBlocking((count) => count - 1);
      }
    });
  }

  /** Saves the note if it changed since it was last saved (on blur, and when the drawer closes). */
  function saveNotes() {
    const next = notes.trim() || null;
    if (next === sentNotes.current) return;
    sentNotes.current = next;
    save({ notes }, { block: false });
  }

  // Escape and the scrim close the drawer without blurring the textarea, so save a pending note here too.
  const close = () => { saveNotes(); onClose(); };

  // One rule action at a time: a double click mustn't add the same rule twice (the `rules` prop
  // only learns about the new one after the page reloads) or apply a rule twice at once.
  const [ruleBusy, setRuleBusy] = useState(false);
  const ruleRunning = useRef(false);
  async function ruleAction(work: () => Promise<void>) {
    if (ruleRunning.current) return;
    ruleRunning.current = true;
    setRuleBusy(true);
    try { await work(); } finally { ruleRunning.current = false; setRuleBusy(false); }
  }

  const createRule = () => ruleAction(async () => {
    if (transaction.categoryId === null) return;
    try {
      const rule = existingRule
        ? await saveCategoryRule(context, existingRule.id, { categoryId: transaction.categoryId })
        : await saveCategoryRule(context, null, { matchText: merchant, matchField: field, categoryId: transaction.categoryId, plaidAccountId: onlyThisAccount ? transaction.plaidAccountId : null, setExcluded: null });
      setNewRule(rule);
      onRulesChanged(false);
      notify(existingRule ? "Rule updated" : "Rule added");
    } catch (reason) {
      notify(errorText(reason, "Couldn't add the rule."), true);
    }
  });

  const applyRule = (rule: CategoryRule) => ruleAction(async () => {
    try {
      const changed = await applyRuleToExisting(context, rule);
      setNewRule(null);
      onRulesChanged(true);
      notify(`${changed} transaction${changed === 1 ? "" : "s"} updated`);
    } catch (reason) {
      notify(errorText(reason, "Couldn't apply the rule."), true);
    }
  });

  const ruleCategory = existingRule ? categories.find((item) => item.id === existingRule.categoryId) : undefined;

  return (
    <Drawer title={merchant} onClose={close}>
      <div className="txn-summary">
        <span className={`num txn-big${transaction.amountCents > 0 ? " in" : ""}`}>{transactionAmount(transaction.amountCents)}</span>
        <span className="txn-facts">
          {fullDate(transaction.date)}{transaction.authorizedDate && transaction.authorizedDate !== transaction.date ? ` (authorized ${fullDate(transaction.authorizedDate)})` : ""}
          <br />{bankAccountLabel(account, portfolio, { full: true })}
        </span>
        <span className="inline-actions">
          {transaction.pending && <Tag tone="due">Pending</Tag>}
          {transaction.excluded && <Tag>Excluded</Tag>}
          {transaction.reviewed && <Tag tone="ok">Reviewed</Tag>}
        </span>
        {transaction.merchantName && transaction.name !== transaction.merchantName && <p className="hint">Bank description: {transaction.name}</p>}
      </div>

      <section className="fieldset">
        <h3>Category</h3>
        <CategoryPicker categories={categories} value={transaction.categoryId} allowNone label="Category" onChange={(id) => { if (id !== transaction.categoryId) save({ categoryId: id }); }} />
        <p className="hint">
          {transaction.categorySource ? `${categoryLabel(category)} · ${SOURCE_LABELS[transaction.categorySource]}` : "Not categorized yet"}
          {transaction.plaidCategoryDetailed ? ` · Plaid: ${plaidCode(transaction.plaidCategoryDetailed)}` : ""}
        </p>
      </section>

      <section className="fieldset">
        <h3>Always categorize</h3>
        {newRule ? (
          <div className="inline-form">
            <span>New {merchant} transactions will be {categoryLabel(categories.find((item) => item.id === newRule.categoryId))}.</span>
            <div className="inline-actions">
              <button type="button" className="btn small primary" disabled={ruleBusy} onClick={() => void applyRule(newRule)}>Apply to past {merchant} transactions</button>
              <button type="button" className="btn small" onClick={() => setNewRule(null)}>Not now</button>
            </div>
            <p className="hint">Transactions you categorized by hand stay as they are.</p>
          </div>
        ) : existingRule && existingRule.categoryId === transaction.categoryId ? (
          <div className="inline-actions">
            <span className="hint">A rule already files {merchant} under {categoryLabel(ruleCategory)}.</span>
            <button type="button" className="btn small" disabled={ruleBusy} onClick={() => void applyRule(existingRule)}>Apply to past</button>
          </div>
        ) : transaction.categoryId === null ? (
          <p className="hint">Pick a category first, then you can file every {merchant} transaction under it.</p>
        ) : (
          <>
            <button type="button" className="btn" disabled={ruleBusy} onClick={() => void createRule()}>Always categorize {merchant} as {categoryLabel(category)}</button>
            {existingRule
              ? <p className="hint">Replaces the rule filing it under {categoryLabel(ruleCategory)}.</p>
              : <label className="check"><input type="checkbox" checked={onlyThisAccount} onChange={(event) => setOnlyThisAccount(event.target.checked)} /> Only on this account</label>}
          </>
        )}
      </section>

      <section className="fieldset">
        <h3>Notes</h3>
        <label className="f">
          <textarea aria-label="Notes" rows={3} value={notes} placeholder="Add a note (searchable)" onChange={(event) => setNotes(event.target.value)}
            onBlur={saveNotes} />
        </label>
      </section>

      <section className="fieldset">
        <label className="check"><input type="checkbox" checked={transaction.excluded} disabled={blocking > 0} onChange={(event) => save({ excluded: event.target.checked })} /> Exclude from cash flow</label>
        <label className="check"><input type="checkbox" checked={transaction.reviewed} disabled={blocking > 0} onChange={(event) => save({ reviewed: event.target.checked })} /> Reviewed</label>
      </section>
    </Drawer>
  );
}
