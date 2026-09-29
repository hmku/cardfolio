"use client";

import { useMemo, useState } from "react";
import { creditIsDue, creditState, eligibleHoldings } from "../lib/core/credits";
import { isoDate } from "../lib/core/dates";
import { holdingName, nextHoldingNumber, personCode, shortName, type Account, type BonusUnit, type Holding, type Kind, type OpenedVia, type Portfolio } from "../lib/core/model";
import type { AccountDraft, ProductDraft } from "../lib/data";
import type { CellTarget } from "./CardGroups";
import { CreditCell } from "./CreditCell";
import { Drawer, fullDate, money, shortDate, toCents, toDollarsInput } from "./ui";

export type ProductChange = { productId: number | "new"; newProduct?: ProductDraft; date: string; annualFeeCents: number; last4: string | null; direction: "upgrade" | "downgrade" };

type Props = {
  portfolio: Portfolio;
  accountId: number | null;
  defaultPersonId: number;
  today: Date;
  onClose: () => void;
  onSave: (draft: AccountDraft, newProduct: ProductDraft | null) => Promise<void>;
  onChangeProduct: (change: ProductChange) => Promise<void>;
  onUndoChange: () => Promise<void>;
  onDelete: () => Promise<void>;
  onToggle: (target: CellTarget) => void;
  onMenu: (target: CellTarget, anchor: DOMRect) => void;
};

const VIA: Array<[OpenedVia, string]> = [["applied", "Applied"], ["referral", "Referral"], ["nll_offer", "NLL offer"], ["other", "Other"]];

function draftFrom(portfolio: Portfolio, account: Account | undefined, defaultPersonId: number, today: Date): AccountDraft {
  if (account) {
    const current = portfolio.current(account.id)!;
    return {
      personId: account.personId, productId: current.productId, number: current.number, last4: current.last4,
      appliedOn: account.appliedOn, approvedOn: account.approvedOn, openedVia: account.openedVia, status: account.status,
      closedOn: account.closedOn, annualFeeCents: current.annualFeeCents, bonus: account.bonus, bonusEarned: account.bonusEarned, note: account.note,
    };
  }
  const product = [...portfolio.products].sort((left, right) => left.name.localeCompare(right.name))[0];
  return {
    personId: defaultPersonId, productId: product?.id ?? 0, number: null, last4: null, appliedOn: isoDate(today), approvedOn: isoDate(today),
    openedVia: "applied", status: "open", closedOn: null, annualFeeCents: product?.annualFeeCents ?? 0, bonus: null, bonusEarned: false, note: null,
  };
}

function NewProductFields({ value, onChange, idPrefix }: { value: ProductDraft; onChange: (value: ProductDraft) => void; idPrefix: string }) {
  return (
    <div className="fields full inline-form">
      <label className="f full" htmlFor={`${idPrefix}-name`}>New card type name<input id={`${idPrefix}-name`} value={value.name} placeholder="Chase Sapphire Reserve" onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
      <label className="f" htmlFor={`${idPrefix}-issuer`}>Issuer<input id={`${idPrefix}-issuer`} value={value.issuer} placeholder="Chase" onChange={(event) => onChange({ ...value, issuer: event.target.value })} /></label>
      <label className="f" htmlFor={`${idPrefix}-kind`}>Kind
        <select id={`${idPrefix}-kind`} value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as Kind })}>
          <option value="personal">Personal (counts for 5/24)</option><option value="business">Business</option><option value="other">Other</option>
        </select>
      </label>
    </div>
  );
}

const emptyProduct: ProductDraft = { name: "", issuer: "", kind: "personal", annualFeeCents: 0 };

export function AccountDrawer(props: Props) {
  const { portfolio, accountId, defaultPersonId, today } = props;
  const account = accountId === null ? undefined : portfolio.account(accountId);
  const isNew = !account;
  const current = account ? portfolio.current(account.id) : undefined;
  const holdings = account ? portfolio.holdingsOf(account.id) : [];
  const [draft, setDraft] = useState<AccountDraft>(() => draftFrom(portfolio, account, defaultPersonId, today));
  const [productChoice, setProductChoice] = useState<string>(String(draft.productId || "new"));
  const [newProduct, setNewProduct] = useState<ProductDraft>(emptyProduct);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState<ProductChange>(() => ({ productId: current?.productId ?? 0, date: isoDate(today), annualFeeCents: 0, last4: null, direction: "downgrade" }));
  const [changeProductDraft, setChangeProductDraft] = useState<ProductDraft>(emptyProduct);

  const products = useMemo(() => [...portfolio.products].sort((left, right) => left.name.localeCompare(right.name)), [portfolio.products]);
  const people = [...portfolio.people].sort((left, right) => left.sort - right.sort);
  const set = (patch: Partial<AccountDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const setBonus = (patch: Partial<NonNullable<AccountDraft["bonus"]>>) => setDraft((value) => {
    const bonus = { amount: 0, unit: "points" as BonusUnit, spendCents: null, months: 3, ...value.bonus, ...patch };
    return { ...value, bonus };
  });
  const approved = draft.status === "open" || draft.status === "closed";
  const autoNumber = productChoice !== "new" && approved
    ? nextHoldingNumber(portfolio.holdings.filter((holding) => holding.id !== current?.id), draft.personId, Number(productChoice))
    : null;

  const credits = current && account?.status === "open"
    ? portfolio.credits.filter((credit) => credit.productId === current.productId && eligibleHoldings(portfolio, credit, today).some((holding) => holding.id === current.id))
    : [];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const bonus = draft.bonus && draft.bonus.amount > 0 ? draft.bonus : null;
    const creating = productChoice === "new";
    if (creating && !newProduct.name.trim()) { setError("Name the new card type."); return; }
    void run(() => props.onSave({ ...draft, bonus, productId: creating ? 0 : Number(productChoice) }, creating ? { ...newProduct, annualFeeCents: draft.annualFeeCents } : null));
  }

  const title = account && current
    ? `${holdingName(portfolio, current)} · ${portfolio.person(account.personId)?.name}`
    : "Add a card";

  return (
    <Drawer
      title={title}
      onClose={props.onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" style={{ marginRight: "auto" }} disabled={busy}
              onClick={() => (confirmDelete ? void run(props.onDelete) : setConfirmDelete(true))}>
              {confirmDelete ? "Tap again to delete" : "Delete"}
            </button>
          )}
          <button type="button" className="btn" onClick={props.onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : isNew ? "Add card" : "Save"}</button>
        </>
      }
    >
      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="fieldset">
        <h3>Card</h3>
        <div className="fields">
          <label className="f full" htmlFor="f-product">{isNew ? "Card type" : "Card type (to correct a mistake; use Change product for an upgrade or downgrade)"}
            <select id="f-product" value={productChoice} onChange={(event) => {
              setProductChoice(event.target.value);
              const product = portfolio.products.find((item) => item.id === Number(event.target.value));
              if (product && isNew) set({ annualFeeCents: product.annualFeeCents });
            }}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.issuer})</option>)}
              <option value="new">+ New card type…</option>
            </select>
          </label>
          {productChoice === "new" && <NewProductFields value={newProduct} onChange={setNewProduct} idPrefix="f-new" />}
          <label className="f" htmlFor="f-person">Cardholder
            <select id="f-person" value={draft.personId} onChange={(event) => set({ personId: Number(event.target.value) })}>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <label className="f" htmlFor="f-via">How we got it
            <select id="f-via" value={draft.openedVia} onChange={(event) => set({ openedVia: event.target.value as OpenedVia })}>
              {VIA.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              {draft.openedVia === "product_change" && <option value="product_change">Product change (not counted for 5/24)</option>}
            </select>
          </label>
          <label className="f" htmlFor="f-number">Card number
            <input id="f-number" type="number" min="1" inputMode="numeric" placeholder={autoNumber ? `${autoNumber} (automatic: ${personCode(portfolio.person(draft.personId))}${autoNumber})` : "Set when approved"} value={draft.number ?? ""}
              onChange={(event) => set({ number: event.target.value ? Number(event.target.value) : null })} />
          </label>
          <label className="f" htmlFor="f-last4">Last digits
            <input id="f-last4" inputMode="numeric" maxLength={5} placeholder="Optional" value={draft.last4 ?? ""} onChange={(event) => set({ last4: event.target.value.replace(/\D/g, "") || null })} />
          </label>
          <label className="f" htmlFor="f-applied">Applied<input id="f-applied" type="date" value={draft.appliedOn ?? ""} onChange={(event) => set({ appliedOn: event.target.value || null })} /></label>
          <label className="f" htmlFor="f-approved">Approved<input id="f-approved" type="date" value={draft.approvedOn ?? ""} disabled={!approved} onChange={(event) => set({ approvedOn: event.target.value || null })} /></label>
          <label className="f" htmlFor="f-status">Status
            <select id="f-status" value={draft.status} onChange={(event) => set({ status: event.target.value as AccountDraft["status"] })}>
              <option value="pending">Pending</option><option value="open">Open</option><option value="declined">Declined</option><option value="closed">Closed</option>
            </select>
          </label>
          <label className="f" htmlFor="f-fee">Annual fee ($)<input id="f-fee" type="number" min="0" step="1" inputMode="numeric" value={toDollarsInput(draft.annualFeeCents)} placeholder="0" onChange={(event) => set({ annualFeeCents: toCents(event.target.value) })} /></label>
          {(draft.status === "closed" || draft.status === "declined") && (
            <label className="f" htmlFor="f-closed">{draft.status === "closed" ? "Closed on" : "Declined on"}<input id="f-closed" type="date" value={draft.closedOn ?? ""} onChange={(event) => set({ closedOn: event.target.value || null })} /></label>
          )}
        </div>
        <p className="hint">The card number counts each card type per person in order, including upgrades and downgrades, and shows with the cardholder&apos;s initials (HK7). Leave it blank to use the next number.</p>
      </div>

      <div className="fieldset">
        <h3>Welcome bonus</h3>
        <div className="fields">
          <label className="f" htmlFor="f-bonus">Bonus<input id="f-bonus" type="number" min="0" inputMode="numeric" placeholder="175000" value={draft.bonus?.amount || ""} onChange={(event) => setBonus({ amount: Number(event.target.value || 0) })} /></label>
          <label className="f" htmlFor="f-unit">Paid as
            <select id="f-unit" value={draft.bonus?.unit || "points"} onChange={(event) => setBonus({ unit: event.target.value as BonusUnit })}>
              <option value="points">Points or miles</option><option value="cash">Cash back ($)</option><option value="nights">Free nights</option>
            </select>
          </label>
          <label className="f" htmlFor="f-spend">Spend required ($)<input id="f-spend" type="number" min="0" inputMode="numeric" placeholder="12000" value={toDollarsInput(draft.bonus?.spendCents)} onChange={(event) => setBonus({ spendCents: event.target.value ? toCents(event.target.value) : null })} /></label>
          <label className="f" htmlFor="f-months">Within (months)<input id="f-months" type="number" min="1" inputMode="numeric" value={draft.bonus?.months || 3} onChange={(event) => setBonus({ months: Math.max(1, Number(event.target.value || 3)) })} /></label>
          <label className="check full" htmlFor="f-earned"><input id="f-earned" type="checkbox" checked={draft.bonusEarned} onChange={(event) => set({ bonusEarned: event.target.checked })} /> Bonus earned</label>
        </div>
      </div>

      <div className="fieldset">
        <h3>Notes</h3>
        <label className="f" htmlFor="f-note"><input id="f-note" placeholder="Retention offers, recon notes, anything else" value={draft.note ?? ""} onChange={(event) => set({ note: event.target.value || null })} /></label>
      </div>

      {account && current && (
        <div className="fieldset">
          <h3>Product history</h3>
          <ul className="history-list">
            {holdings.map((holding: Holding) => {
              const end = portfolio.holdingEnd(holding);
              return (
                <li key={holding.id} className={holding.id === current.id && account.status === "open" ? "current" : ""}>
                  <span className="grow">
                    <strong>{holdingName(portfolio, holding, true)}</strong>
                    <br /><small>{holding.change === "opened" ? "Opened" : holding.change === "upgrade" ? "Upgraded" : "Downgraded"} {fullDate(holding.startedOn)}{end ? ` · until ${fullDate(end)}` : ""}</small>
                  </span>
                  <span className="num">{holding.annualFeeCents ? money(holding.annualFeeCents) : "no fee"}</span>
                </li>
              );
            })}
          </ul>
          {account.status === "open" && !changing && (
            <div className="inline-actions">
              <button type="button" className="btn small" onClick={() => setChanging(true)}>Change product (upgrade or downgrade)</button>
              {holdings.length > 1 && <button type="button" className="btn small" disabled={busy} onClick={() => void run(props.onUndoChange)}>Undo last change</button>}
            </div>
          )}
          {changing && (
            <div className="inline-form">
              <div className="fields">
                <label className="f" htmlFor="c-direction">Change
                  <select id="c-direction" value={change.direction} onChange={(event) => setChange({ ...change, direction: event.target.value as ProductChange["direction"] })}>
                    <option value="downgrade">Downgrade</option><option value="upgrade">Upgrade</option>
                  </select>
                </label>
                <label className="f" htmlFor="c-date">On<input id="c-date" type="date" value={change.date} onChange={(event) => setChange({ ...change, date: event.target.value })} /></label>
                <label className="f full" htmlFor="c-product">New card type
                  <select id="c-product" value={String(change.productId)} onChange={(event) => {
                    const value = event.target.value === "new" ? "new" : Number(event.target.value);
                    const product = portfolio.products.find((item) => item.id === value);
                    setChange({ ...change, productId: value, annualFeeCents: product?.annualFeeCents ?? change.annualFeeCents });
                  }}>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    <option value="new">+ New card type…</option>
                  </select>
                </label>
                {change.productId === "new" && <NewProductFields value={changeProductDraft} onChange={setChangeProductDraft} idPrefix="c-new" />}
                <label className="f" htmlFor="c-fee">Annual fee ($)<input id="c-fee" type="number" min="0" inputMode="numeric" value={toDollarsInput(change.annualFeeCents)} placeholder="0" onChange={(event) => setChange({ ...change, annualFeeCents: toCents(event.target.value) })} /></label>
                <label className="f" htmlFor="c-last4">New last digits<input id="c-last4" inputMode="numeric" maxLength={5} placeholder="If the number changed" value={change.last4 ?? ""} onChange={(event) => setChange({ ...change, last4: event.target.value.replace(/\D/g, "") || null })} /></label>
              </div>
              <p className="hint">
                {change.productId !== "new" && change.productId
                  ? `Becomes ${shortName(portfolio.product(change.productId))} ${personCode(portfolio.person(account.personId))}${nextHoldingNumber(portfolio.holdings, account.personId, change.productId)}. `
                  : ""}
                The account keeps its opening date, so 5/24 doesn&apos;t change.
              </p>
              <div className="inline-actions">
                <button type="button" className="btn small" onClick={() => setChanging(false)}>Cancel</button>
                <button type="button" className="btn small primary" disabled={busy || change.productId === current.productId} onClick={() => {
                  if (change.productId === "new" && !changeProductDraft.name.trim()) { setError("Name the new card type."); return; }
                  void run(async () => { await props.onChangeProduct({ ...change, newProduct: change.productId === "new" ? { ...changeProductDraft, annualFeeCents: change.annualFeeCents } : undefined }); setChanging(false); });
                }}>Save change</button>
              </div>
            </div>
          )}
        </div>
      )}

      {current && credits.length > 0 && (
        <div className="fieldset">
          <h3>Credits on this card</h3>
          <div className="inline-credits">
            {credits.map((credit) => {
              const state = creditState(portfolio, credit, current, today);
              const status = state.kind === "off" ? "Not enrolled"
                : state.kind === "used" ? `Used${state.uses.at(-1)?.recordedBy ? ` · marked by ${state.uses.at(-1)?.recordedBy}` : ""}`
                : state.kind === "partial" ? `${money(state.usedCents)} of ${money(credit.amountCents)} used` : "Not used yet";
              return (
                <div key={credit.id} className="inline-credit">
                  <CreditCell credit={credit} state={state} due={creditIsDue(credit, state)} label={credit.name}
                    onToggle={() => props.onToggle({ credit, holding: current })} onMenu={(anchor) => props.onMenu({ credit, holding: current }, anchor)} />
                  <span className="grow">{credit.name} · {money(credit.amountCents)}
                    <small>{status}{state.kind !== "off" && ` · ${state.period.label} ends ${shortDate(state.period.end)}`}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Drawer>
  );
}
