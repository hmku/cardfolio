"use client";

import { useState, type FormEvent } from "react";
import { CADENCE_LABELS } from "../lib/core/credits";
import { exportTables, toCsv } from "../lib/core/export";
import { personCode, shortName, type Cadence, type Credit, type Kind, type Person, type Portfolio, type Product } from "../lib/core/model";
import { describeRule, DEFAULT_ACTION_RULES } from "../lib/core/rules";
import type { CreditDraft, ProductDraft } from "../lib/data";
import { ReminderSettings } from "./ReminderSettings";
import { Drawer, toCents, toDollarsInput } from "./ui";

export type Membership = {
  email: string;
  role: "owner" | "member";
  members: { email: string; role: string }[];
  invitations: { email: string }[];
  googleSheet: boolean;
};

type Props = {
  portfolio: Portfolio;
  today: Date;
  membership: Membership;
  onClose: () => void;
  onSaveProduct: (id: number, draft: ProductDraft) => Promise<void>;
  onSaveCredit: (id: number | null, draft: Partial<CreditDraft>) => Promise<void>;
  onDeleteCredit: (id: number) => Promise<void>;
  onToggleRule: (id: string, enabled: boolean) => Promise<void>;
  onAddPerson: (name: string) => Promise<void>;
  onSavePerson: (id: number, name: string, code: string) => Promise<void>;
  onInvite: (email: string) => Promise<void>;
  onSyncSheet: () => Promise<void>;
  onSignOut: () => Promise<void>;
  accessToken: string;
  notify: (text: string, error?: boolean) => void;
};

const CADENCES = Object.entries(CADENCE_LABELS) as [Cadence, string][];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CreditRow({ credit, onSave, onDelete }: { credit: Credit; onSave: Props["onSaveCredit"]; onDelete: Props["onDeleteCredit"] }) {
  const [name, setName] = useState(credit.name);
  const [amount, setAmount] = useState(toDollarsInput(credit.amountCents));
  const [confirm, setConfirm] = useState(false);
  const saveText = () => {
    const amountCents = toCents(amount);
    if (name.trim() && (name.trim() !== credit.name || (amountCents > 0 && amountCents !== credit.amountCents))) {
      void onSave(credit.id, { name, amountCents: amountCents > 0 ? amountCents : credit.amountCents });
    }
  };
  return (
    <div className="credit-edit">
      <input aria-label="Credit name" value={name} onChange={(event) => setName(event.target.value)} onBlur={saveText} />
      <input aria-label="Amount in dollars" type="number" min="1" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={saveText} />
      <select aria-label="How often" value={credit.cadence} onChange={(event) => void onSave(credit.id, { cadence: event.target.value as Cadence })}>
        {CADENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="check" title="Include in Due soon"><input type="checkbox" checked={credit.remind} onChange={(event) => void onSave(credit.id, { remind: event.target.checked })} /> Remind</label>
      <button type="button" className="btn small danger" onClick={() => (confirm ? void onDelete(credit.id) : setConfirm(true))}>{confirm ? "Sure?" : "Delete"}</button>
    </div>
  );
}

function ProductSettings({ portfolio, product, onSaveProduct, onSaveCredit, onDeleteCredit }: { portfolio: Portfolio; product: Product } & Pick<Props, "onSaveProduct" | "onSaveCredit" | "onDeleteCredit">) {
  const credits = portfolio.credits.filter((credit) => credit.productId === product.id).sort((left, right) => left.sort - right.sort);
  const open = portfolio.accounts.filter((account) => account.status === "open" && portfolio.current(account.id)?.productId === product.id).length;
  const [draft, setDraft] = useState<ProductDraft>({ name: product.name, shortName: product.shortName ?? "", issuer: product.issuer, kind: product.kind, annualFeeCents: product.annualFeeCents });
  const [newCredit, setNewCredit] = useState({ name: "", amount: "", cadence: "calendar_year" as Cadence });
  const saveProduct = (patch: Partial<ProductDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.name.trim()) void onSaveProduct(product.id, next);
  };
  const addCredit = (event: FormEvent) => {
    event.preventDefault();
    if (!newCredit.name.trim() || toCents(newCredit.amount) <= 0) return;
    void onSaveCredit(null, { productId: product.id, name: newCredit.name, amountCents: toCents(newCredit.amount), cadence: newCredit.cadence, remind: true })
      .then(() => setNewCredit({ name: "", amount: "", cadence: "calendar_year" }));
  };
  return (
    <details className="product-card">
      <summary><strong>{product.name}</strong><span className="sub">{shortName(product)}</span><span className="sub">{open} open · {credits.length ? `${credits.length} credit${credits.length === 1 ? "" : "s"}` : "no credits"}</span></summary>
      <div className="fields">
        <label className="f full">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => saveProduct({})} /></label>
        <label className="f">Short name<input value={draft.shortName ?? ""} placeholder={product.slug} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} onBlur={() => saveProduct({})} /></label>
        <label className="f">Issuer<input value={draft.issuer} onChange={(event) => setDraft({ ...draft, issuer: event.target.value })} onBlur={() => saveProduct({})} /></label>
        <label className="f">Kind
          <select value={draft.kind} onChange={(event) => saveProduct({ kind: event.target.value as Kind })}>
            <option value="personal">Personal (counts for 5/24)</option><option value="business">Business</option><option value="other">Other</option>
          </select>
        </label>
        <label className="f">Usual annual fee ($)<input type="number" min="0" inputMode="numeric" value={toDollarsInput(draft.annualFeeCents)} placeholder="0" onChange={(event) => setDraft({ ...draft, annualFeeCents: toCents(event.target.value) })} onBlur={() => saveProduct({})} /></label>
      </div>
      {credits.map((credit) => <CreditRow key={credit.id} credit={credit} onSave={onSaveCredit} onDelete={onDeleteCredit} />)}
      <form className="credit-edit" onSubmit={addCredit}>
        <input aria-label="New credit name" placeholder="New credit" value={newCredit.name} onChange={(event) => setNewCredit({ ...newCredit, name: event.target.value })} />
        <input aria-label="New credit amount in dollars" type="number" min="1" inputMode="decimal" placeholder="$" value={newCredit.amount} onChange={(event) => setNewCredit({ ...newCredit, amount: event.target.value })} />
        <select aria-label="New credit frequency" value={newCredit.cadence} onChange={(event) => setNewCredit({ ...newCredit, cadence: event.target.value as Cadence })}>
          {CADENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span />
        <button type="submit" className="btn small">Add</button>
      </form>
    </details>
  );
}

function PersonRow({ person, onSave }: { person: Person; onSave: Props["onSavePerson"] }) {
  const [code, setCode] = useState(person.code ?? "");
  const save = () => {
    const next = code.trim().toUpperCase();
    if (next !== (person.code ?? "")) void onSave(person.id, person.name, next);
  };
  return (
    <div className="settings-row">
      <span className="grow">{person.name}</span>
      <label className="check">Initials
        <input className="search" style={{ marginLeft: 0, width: "4.5rem", flex: "none" }} aria-label={`${person.name}'s initials`} maxLength={4} placeholder={personCode(person)} value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^a-z]/gi, "").toUpperCase())} onBlur={save} />
      </label>
    </div>
  );
}

export function SettingsDrawer(props: Props) {
  const { portfolio, today, membership } = props;
  const [invite, setInvite] = useState("");
  const [person, setPerson] = useState("");
  const [syncing, setSyncing] = useState(false);
  const rules = portfolio.rules.length ? portfolio.rules : DEFAULT_ACTION_RULES;
  const openProducts = new Set(portfolio.accounts.filter((account) => account.status === "open").map((account) => portfolio.current(account.id)?.productId));
  const creditProducts = new Set(portfolio.credits.map((credit) => credit.productId));
  const products = [...portfolio.products].sort((left, right) =>
    Number(creditProducts.has(right.id)) - Number(creditProducts.has(left.id))
    || Number(openProducts.has(right.id)) - Number(openProducts.has(left.id))
    || left.name.localeCompare(right.name));
  const exportCsv = (tab: "tracker" | "credits" | "stats") => download(`cardfolio-${tab}.csv`, toCsv(exportTables(portfolio, today)[tab]));

  return (
    <Drawer title="Settings" onClose={props.onClose}>
      <div className="fieldset">
        <h3>Card types and credits</h3>
        <p className="hint">Credits set to Remind show up in Due soon. Amounts are per card, per period.</p>
        <div className="settings-list">
          {products.map((product) => <ProductSettings key={product.id} portfolio={portfolio} product={product} onSaveProduct={props.onSaveProduct} onSaveCredit={props.onSaveCredit} onDeleteCredit={props.onDeleteCredit} />)}
        </div>
      </div>

      <div className="fieldset">
        <h3>Review reminders</h3>
        <div className="settings-list">
          {rules.map((rule) => (
            <div key={rule.id} className="settings-row">
              <span className="grow">{rule.name}<small>{describeRule(rule)}</small></span>
              {!rule.id.startsWith("default-") && (
                <label className="check"><input type="checkbox" checked={rule.enabled} onChange={(event) => void props.onToggleRule(rule.id, event.target.checked)} /> On</label>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="fieldset">
        <h3>Cardholders</h3>
        <p className="hint">Initials label each card, like your 1Password entries: biz plat HK7 is this person&apos;s 7th biz plat.</p>
        <div className="settings-list">
          {portfolio.people.map((item) => <PersonRow key={item.id} person={item} onSave={props.onSavePerson} />)}
        </div>
        <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); if (person.trim()) void props.onAddPerson(person).then(() => setPerson("")); }}>
          <input className="search" style={{ marginLeft: 0 }} aria-label="New cardholder name" placeholder="Add a cardholder" value={person} onChange={(event) => setPerson(event.target.value)} />
          <button type="submit" className="btn small">Add</button>
        </form>
      </div>

      <div className="fieldset">
        <h3>Who can sign in</h3>
        <div className="settings-list">
          {membership.members.map((member) => <div key={member.email} className="settings-row"><span className="grow">{member.email}</span><span className="tag">{member.role === "owner" ? "Owner" : "Can edit"}</span></div>)}
          {membership.invitations.map((item) => <div key={item.email} className="settings-row"><span className="grow">{item.email}</span><span className="tag due">Invited</span></div>)}
        </div>
        {membership.role === "owner" && (
          <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); if (invite.trim()) void props.onInvite(invite).then(() => setInvite("")); }}>
            <input className="search" style={{ marginLeft: 0 }} type="email" aria-label="Email to invite" placeholder="Invite by email" value={invite} onChange={(event) => setInvite(event.target.value)} />
            <button type="submit" className="btn small">Invite</button>
          </form>
        )}
      </div>

      <ReminderSettings accessToken={props.accessToken} notify={props.notify} />

      <div className="fieldset">
        <h3>Export</h3>
        <div className="inline-actions">
          <button type="button" className="btn small" onClick={() => exportCsv("tracker")}>Tracker CSV</button>
          <button type="button" className="btn small" onClick={() => exportCsv("credits")}>Credits CSV</button>
          <button type="button" className="btn small" onClick={() => exportCsv("stats")}>Stats CSV</button>
        </div>
        {membership.googleSheet ? (
          <div className="inline-actions">
            <button type="button" className="btn small" disabled={syncing} onClick={() => { setSyncing(true); void props.onSyncSheet().finally(() => setSyncing(false)); }}>{syncing ? "Updating…" : "Update Google Sheet now"}</button>
            <p className="hint">The Google Sheet copy also updates a few seconds after every change.</p>
          </div>
        ) : (
          <p className="hint">A read-only Google Sheet copy can be turned on; see the README.</p>
        )}
      </div>

      <div className="fieldset">
        <h3>Account</h3>
        <div className="settings-row"><span className="grow">Signed in as {membership.email}</span><button type="button" className="btn small" onClick={() => void props.onSignOut()}>Sign out</button></div>
      </div>
    </Drawer>
  );
}
