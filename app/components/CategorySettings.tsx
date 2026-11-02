"use client";

import { useState, type FormEvent } from "react";
import type { CategoryKind, RuleField } from "../lib/core/finance";
import type { Portfolio } from "../lib/core/model";
import {
  applyRuleToExisting, deleteCategory, deleteCategoryRule, saveCategory, saveCategoryRule,
  type BankAccount, type Category, type CategoryRule, type FinanceContext,
} from "../lib/finance-data";
import { bankAccountLabel } from "../lib/presentation/account-labels";
import { CategoryPicker, categoryLabel, KIND_LABELS } from "./CategoryPicker";
import { ConfirmButton, Drawer } from "./ui";

const KINDS: CategoryKind[] = ["expense", "income", "transfer"];
const FIELD_LABELS: Record<RuleField, string> = { any: "Merchant or description", merchant: "Merchant", name: "Description" };

type Props = {
  context: FinanceContext;
  portfolio: Portfolio;
  categories: Category[];
  rules: CategoryRule[];
  accounts: BankAccount[];
  notify: (text: string, error?: boolean) => void;
  /** Called after any change so the page reloads categories, rules and (after applying a rule) transactions. */
  onChanged: (transactionsChanged?: boolean) => void;
  onClose: () => void;
};

const message = (reason: unknown) => (reason instanceof Error ? reason.message : "Something went wrong.");

type Run = (work: () => Promise<unknown>, success?: string, transactionsChanged?: boolean) => Promise<boolean>;

function CategoryRow({ category, context, run }: { category: Category; context: FinanceContext; run: Run }) {
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState(category.emoji || "");
  const saveName = () => {
    const next = name.trim();
    if (!next) { setName(category.name); return; }
    if (next !== category.name) void run(() => saveCategory(context, category.id, { name: next }), "Saved");
  };
  const saveEmoji = () => { if ((emoji.trim() || null) !== category.emoji) void run(() => saveCategory(context, category.id, { emoji: emoji.trim() }), "Saved"); };
  return (
    <div className="category-row">
      <input className="emoji-input" aria-label={`${category.name} emoji`} maxLength={8} value={emoji} placeholder="·" onChange={(event) => setEmoji(event.target.value)} onBlur={saveEmoji} />
      <input className="search" aria-label={`${category.name} name`} value={name} onChange={(event) => setName(event.target.value)} onBlur={saveName} />
      <select aria-label={`${category.name} kind`} value={category.kind} onChange={(event) => void run(() => saveCategory(context, category.id, { kind: event.target.value as CategoryKind }), "Saved")}>
        {KINDS.map((kind) => <option key={kind} value={kind}>{kind === "expense" ? "Spending" : kind === "income" ? "Income" : "Transfer"}</option>)}
      </select>
      <ConfirmButton label={`Delete ${category.name}`} onConfirm={() => void run(() => deleteCategory(context, category.id), `Deleted ${category.name}`)} />
    </div>
  );
}

/** "Manage categories": the household's categories (name, emoji, kind) and its auto-categorize rules. */
export function CategorySettings({ context, portfolio, categories, rules, accounts, notify, onChanged, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const [newKind, setNewKind] = useState<CategoryKind>("expense");
  const [ruleText, setRuleText] = useState("");
  const [ruleField, setRuleField] = useState<RuleField>("merchant");
  const [ruleCategory, setRuleCategory] = useState<number | null>(null);
  const [ruleAccount, setRuleAccount] = useState<number | null>(null);
  const [ruleExclude, setRuleExclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const run: Run = async (work, success, transactionsChanged) => {
    try {
      await work();
      if (success) notify(success);
      onChanged(transactionsChanged);
      return true;
    } catch (reason) {
      notify(message(reason), true);
      return false;
    }
  };

  const addCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    const ok = await run(() => saveCategory(context, null, { name: newName, emoji: newEmoji.trim(), kind: newKind, sort: Math.max(0, ...categories.map((category) => category.sort)) + 10 }), `Added ${newName.trim()}`);
    setBusy(false);
    if (ok) { setNewName(""); setNewEmoji(""); }
  };

  const addRule = async (event: FormEvent) => {
    event.preventDefault();
    if (!ruleText.trim() || ruleCategory === null || busy) return;
    setBusy(true);
    const ok = await run(async () => {
      const rule = await saveCategoryRule(context, null, { matchText: ruleText, matchField: ruleField, categoryId: ruleCategory, plaidAccountId: ruleAccount, setExcluded: ruleExclude ? true : null });
      const changed = await applyRuleToExisting(context, rule);
      notify(`Rule added; ${changed} past transaction${changed === 1 ? "" : "s"} updated`);
    }, undefined, true);
    setBusy(false);
    if (ok) { setRuleText(""); setRuleExclude(false); }
  };

  const describe = (rule: CategoryRule) => {
    const account = rule.plaidAccountId === null ? "" : ` on ${bankAccountLabel(accountById.get(rule.plaidAccountId), portfolio) || "one account"}`;
    return `${FIELD_LABELS[rule.matchField]} contains “${rule.matchText}”${account}`;
  };

  return (
    <Drawer title="Manage categories" onClose={onClose}>
      {KINDS.map((kind) => {
        const list = categories.filter((category) => category.kind === kind);
        return (
          <section key={kind} className="fieldset settings-section">
            <h3>{KIND_LABELS[kind]}</h3>
            {kind === "transfer" && <p className="hint">Card payments and moving money between your own accounts. Never counted as income or spending.</p>}
            <div className="settings-list">
              {list.map((category) => <CategoryRow key={`${category.id}-${category.name}-${category.emoji}`} category={category} context={context} run={run} />)}
              {!list.length && <p className="hint">None yet.</p>}
            </div>
          </section>
        );
      })}

      <form className="inline-form" onSubmit={(event) => void addCategory(event)}>
        <strong>New category</strong>
        <div className="category-row">
          <input className="emoji-input" aria-label="New category emoji" maxLength={8} value={newEmoji} placeholder="🙂" onChange={(event) => setNewEmoji(event.target.value)} />
          <input className="search" aria-label="New category name" placeholder="Name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          <select aria-label="New category kind" value={newKind} onChange={(event) => setNewKind(event.target.value as CategoryKind)}>
            <option value="expense">Spending</option><option value="income">Income</option><option value="transfer">Transfer</option>
          </select>
          <button type="submit" className="btn small" disabled={!newName.trim() || busy}>Add</button>
        </div>
      </form>

      <section className="fieldset settings-section">
        <h3>Rules</h3>
        <p className="hint">New transactions that match get the rule&apos;s category. A rule for one account wins over a general one, then the longest text. Categories you set by hand are never changed.</p>
        <div className="settings-list">
          {rules.map((rule) => {
            const category = byId.get(rule.categoryId);
            return (
              <div key={rule.id} className="settings-row">
                <span className="grow">{describe(rule)}<small>→ {categoryLabel(category)}{rule.setExcluded ? " · also excluded from cash flow" : ""}</small></span>
                <button type="button" className="btn small" onClick={() => void run(async () => {
                  const changed = await applyRuleToExisting(context, rule);
                  notify(`${changed} transaction${changed === 1 ? "" : "s"} updated`);
                }, undefined, true)}>Apply to past</button>
                <ConfirmButton label={`Delete rule ${rule.matchText}`} onConfirm={() => void run(() => deleteCategoryRule(context, rule.id), "Rule deleted")} />
              </div>
            );
          })}
          {!rules.length && <p className="hint">No rules yet. Open a transaction and use “Always categorize…”, or add one here.</p>}
        </div>
        <form className="inline-form" onSubmit={(event) => void addRule(event)}>
          <strong>New rule</strong>
          <div className="fields">
            <label className="f">When
              <select value={ruleField} onChange={(event) => setRuleField(event.target.value as RuleField)}>
                {(Object.keys(FIELD_LABELS) as RuleField[]).map((field) => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
              </select>
            </label>
            <label className="f">contains
              <input value={ruleText} placeholder="e.g. Whole Foods" onChange={(event) => setRuleText(event.target.value)} />
            </label>
            <label className="f full">On account
              <select value={ruleAccount ?? ""} onChange={(event) => setRuleAccount(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Any account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{bankAccountLabel(account, portfolio, { full: true })}</option>)}
              </select>
            </label>
            <div className="full"><CategoryPicker categories={categories} value={ruleCategory} onChange={setRuleCategory} label="Rule category" placeholder="Choose a category" /></div>
            <label className="check full"><input type="checkbox" checked={ruleExclude} onChange={(event) => setRuleExclude(event.target.checked)} /> Also exclude from cash flow</label>
          </div>
          <div className="inline-actions"><button type="submit" className="btn small" disabled={!ruleText.trim() || ruleCategory === null || busy}>Add rule and apply to past</button></div>
        </form>
      </section>
    </Drawer>
  );
}
