"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CADENCE_LABELS } from "../lib/core/credits";
import { exportTables, toCsv } from "../lib/core/export";
import { personCode, shortName, type Cadence, type Credit, type Kind, type Person, type Portfolio, type Product } from "../lib/core/model";
import { describeRule, DEFAULT_ACTION_RULES } from "../lib/core/rules";
import type { Context, CreditDraft, ProductDraft } from "../lib/data";
import { ReminderSettings } from "./ReminderSettings";
import { AgentSettings } from "./AgentSettings";
import { Drawer } from "./ui";
import { toCents, toDollarsInput } from "../lib/presentation/format";

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
  /** Scroll to and focus a section when the drawer opens (the empty page's "Add a cardholder"). */
  focus?: "people";
  onClose: () => void;
  onSaveProduct: (id: number, draft: ProductDraft) => Promise<boolean>;
  onSaveCredit: (id: number | null, draft: Partial<CreditDraft>) => Promise<boolean>;
  onDeleteCredit: (id: number) => Promise<boolean>;
  onToggleRule: (id: string, enabled: boolean) => Promise<boolean>;
  onAddPerson: (name: string) => Promise<boolean>;
  onSavePerson: (id: number, name: string, code: string) => Promise<boolean>;
  onInvite: (email: string) => Promise<boolean>;
  onSyncSheet: () => Promise<void>;
  onSignOut: () => Promise<void>;
  accessToken: string;
  context: Context;
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

/** A two-step delete button: the first press asks "Sure?", which resets after a few seconds. */
function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);
  return (
    <button type="button" className="btn small danger credit-delete" aria-label={confirm ? `Confirm delete ${label}` : `Delete ${label}`} onClick={() => (confirm ? onDelete() : setConfirm(true))}>
      {confirm ? "Sure?" : "Delete"}
    </button>
  );
}

/** A small form that keeps what was typed if the save fails and ignores repeat presses while saving. */
function AddForm({ className, onAdd, children, button, ready }: { className: string; onAdd: () => Promise<boolean>; children: ReactNode; button: string; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    void onAdd().finally(() => setBusy(false));
  };
  return (
    <form className={className} onSubmit={submit}>
      {children}
      <button type="submit" className="btn small" disabled={!ready || busy}>{busy ? "Adding…" : button}</button>
    </form>
  );
}

function DollarInput({ label, value, onChange, onBlur, placeholder }: { label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; placeholder?: string }) {
  return (
    <span className="dollar-input">
      <input aria-label={label} type="number" min="0" step="0.01" inputMode="decimal" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
    </span>
  );
}

function CreditRow({ credit, onSave, onDelete }: { credit: Credit; onSave: Props["onSaveCredit"]; onDelete: Props["onDeleteCredit"] }) {
  const [name, setName] = useState(credit.name);
  const [amount, setAmount] = useState(toDollarsInput(credit.amountCents));
  const saveText = () => {
    const amountCents = toCents(amount);
    const nextName = name.trim() || credit.name;
    const nextAmount = amountCents > 0 ? amountCents : credit.amountCents;
    // Put back anything that can't be saved (a blank name or a zero amount).
    setName(nextName);
    setAmount(toDollarsInput(nextAmount));
    if (nextName !== credit.name || nextAmount !== credit.amountCents) void onSave(credit.id, { name: nextName, amountCents: nextAmount });
  };
  return (
    <div className="credit-edit">
      <input className="credit-name" aria-label="Credit name" value={name} onChange={(event) => setName(event.target.value)} onBlur={saveText} />
      <DollarInput label={`${credit.name} amount in dollars`} value={amount} onChange={setAmount} onBlur={saveText} />
      <select aria-label={`How often ${credit.name} resets`} value={credit.cadence} onChange={(event) => void onSave(credit.id, { cadence: event.target.value as Cadence })}>
        {CADENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="check" title="Show in To do when it's unused near the end of a period">
        <input type="checkbox" checked={credit.remind} onChange={(event) => void onSave(credit.id, { remind: event.target.checked })} /> Remind
      </label>
      <DeleteButton label={credit.name} onDelete={() => void onDelete(credit.id)} />
    </div>
  );
}

const EMPTY_CREDIT = { name: "", amount: "", cadence: "calendar_year" as Cadence, remind: true };

function ProductSettings({ portfolio, product, open, onSaveProduct, onSaveCredit, onDeleteCredit }: { portfolio: Portfolio; product: Product; open: number } & Pick<Props, "onSaveProduct" | "onSaveCredit" | "onDeleteCredit">) {
  const credits = portfolio.credits.filter((credit) => credit.productId === product.id).sort((left, right) => left.sort - right.sort);
  const saved: ProductDraft = { name: product.name, shortName: product.shortName ?? "", issuer: product.issuer, kind: product.kind, annualFeeCents: product.annualFeeCents };
  const [draft, setDraft] = useState<ProductDraft>(saved);
  const [fee, setFee] = useState(toDollarsInput(product.annualFeeCents));
  const [newCredit, setNewCredit] = useState(EMPTY_CREDIT);
  const saveProduct = (patch: Partial<ProductDraft> = {}) => {
    const next = { ...draft, ...patch, annualFeeCents: patch.annualFeeCents ?? toCents(fee) };
    if (!next.name.trim()) next.name = product.name;
    setDraft(next);
    setFee(toDollarsInput(next.annualFeeCents));
    const changed = (Object.keys(saved) as (keyof ProductDraft)[]).some((key) => String(next[key] ?? "").trim() !== String(saved[key] ?? "").trim());
    if (changed) void onSaveProduct(product.id, next);
  };
  const addCredit = () => onSaveCredit(null, { productId: product.id, name: newCredit.name, amountCents: toCents(newCredit.amount), cadence: newCredit.cadence, remind: newCredit.remind })
    .then((ok) => { if (ok) setNewCredit(EMPTY_CREDIT); return ok; });
  const meta = [open ? `${open} open` : "none open", credits.length ? `${credits.length} credit${credits.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");

  return (
    <details className="product-card">
      <summary>
        <span className="product-title"><strong>{product.name}</strong><span className="sub">{shortName(product)}</span></span>
        <span className="sub product-meta">{meta}</span>
      </summary>
      <div className="product-body">
        <div className="fields">
          <label className="f full">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => saveProduct()} /></label>
          <label className="f">Short name<input value={draft.shortName ?? ""} placeholder={product.slug} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} onBlur={() => saveProduct()} /></label>
          <label className="f">Issuer<input value={draft.issuer} onChange={(event) => setDraft({ ...draft, issuer: event.target.value })} onBlur={() => saveProduct()} /></label>
          <label className="f">Kind
            <select value={draft.kind} onChange={(event) => saveProduct({ kind: event.target.value as Kind })}>
              <option value="personal">Personal (5/24)</option><option value="business">Business</option><option value="other">Other</option>
            </select>
          </label>
          <label className="f">Usual annual fee<DollarInput label="Usual annual fee in dollars" value={fee} placeholder="0" onChange={setFee} onBlur={() => saveProduct()} /></label>
        </div>

        <div className="credit-list">
          <h4>Credits</h4>
          {credits.map((credit) => <CreditRow key={credit.id} credit={credit} onSave={onSaveCredit} onDelete={onDeleteCredit} />)}
          <AddForm className="credit-edit credit-new" onAdd={addCredit} button="Add" ready={!!newCredit.name.trim() && toCents(newCredit.amount) > 0}>
            <input className="credit-name" aria-label="New credit name" placeholder="Add a credit" value={newCredit.name} onChange={(event) => setNewCredit({ ...newCredit, name: event.target.value })} />
            <DollarInput label="New credit amount in dollars" placeholder="0" value={newCredit.amount} onChange={(amount) => setNewCredit({ ...newCredit, amount })} />
            <select aria-label="How often the new credit resets" value={newCredit.cadence} onChange={(event) => setNewCredit({ ...newCredit, cadence: event.target.value as Cadence })}>
              {CADENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={newCredit.remind} onChange={(event) => setNewCredit({ ...newCredit, remind: event.target.checked })} /> Remind</label>
          </AddForm>
        </div>
      </div>
    </details>
  );
}

function PersonRow({ person, onSave }: { person: Person; onSave: Props["onSavePerson"] }) {
  const [name, setName] = useState(person.name);
  const [code, setCode] = useState(person.code ?? "");
  const save = () => {
    const nextName = name.trim() || person.name;
    const nextCode = code.trim().toUpperCase();
    setName(nextName);
    if (nextName !== person.name || nextCode !== (person.code ?? "")) {
      void onSave(person.id, nextName, nextCode).then((ok) => { if (!ok) { setName(person.name); setCode(person.code ?? ""); } });
    }
  };
  return (
    <div className="settings-row person-row">
      <input className="search grow" aria-label="Cardholder name" value={name} onChange={(event) => setName(event.target.value)} onBlur={save} />
      <label className="check">Initials
        <input className="search person-code-input" aria-label={`${person.name}'s initials`} maxLength={4} placeholder={personCode(person)} value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^a-z]/gi, "").toUpperCase())} onBlur={save} />
      </label>
    </div>
  );
}

function Section({ title, hint, children, id }: { title: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="fieldset settings-section" id={id}>
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function SettingsDrawer(props: Props) {
  const { portfolio, today, membership } = props;
  const [invite, setInvite] = useState("");
  const [person, setPerson] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  useEffect(() => {
    if (props.focus !== "people") return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("settings-people")?.scrollIntoView({ block: "start" });
      document.querySelector<HTMLInputElement>("input[aria-label='New cardholder name']")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.focus]);
  const rules = portfolio.rules.length ? portfolio.rules : DEFAULT_ACTION_RULES;
  const openCount = new Map<number, number>();
  for (const account of portfolio.accounts) {
    const productId = account.status === "open" ? portfolio.current(account.id)?.productId : undefined;
    if (productId !== undefined) openCount.set(productId, (openCount.get(productId) ?? 0) + 1);
  }
  const creditProducts = new Set(portfolio.credits.map((credit) => credit.productId));
  const inUse = (product: Product) => openCount.has(product.id) || creditProducts.has(product.id);
  // Card types with credits first (they're edited most), then the rest by name.
  const sorted = [...portfolio.products].sort((left, right) =>
    Number(creditProducts.has(right.id)) - Number(creditProducts.has(left.id)) || left.name.localeCompare(right.name));
  const used = sorted.filter(inUse);
  const unused = sorted.filter((product) => !inUse(product));
  const exportCsv = (tab: "tracker" | "credits" | "stats") => download(`cardfolio-${tab}.csv`, toCsv(exportTables(portfolio, today)[tab]));
  const productProps = { portfolio, onSaveProduct: props.onSaveProduct, onSaveCredit: props.onSaveCredit, onDeleteCredit: props.onDeleteCredit };
  const addPerson = () => props.onAddPerson(person).then((ok) => { if (ok) setPerson(""); return ok; });
  const sendInvite = () => props.onInvite(invite.trim()).then((ok) => { if (ok) setInvite(""); return ok; });

  return (
    <Drawer title="Settings" onClose={props.onClose}>
      <Section title="Card types and credits" hint="Tap a card type to edit it. Credit amounts are per card, per period; ones set to Remind show up in To do.">
        <div className="settings-list">
          {used.map((product) => <ProductSettings key={product.id} product={product} open={openCount.get(product.id) ?? 0} {...productProps} />)}
          {showUnused && unused.map((product) => <ProductSettings key={product.id} product={product} open={0} {...productProps} />)}
        </div>
        {unused.length > 0 && (
          <button type="button" className="btn small show-more" aria-expanded={showUnused} onClick={() => setShowUnused(!showUnused)}>
            {showUnused ? "Hide card types with no open cards" : `Show ${unused.length} card types with no open cards`}
          </button>
        )}
      </Section>

      <Section title="Review rules" hint="Each rule adds a Review item to To do while a card is in its window.">
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
      </Section>

      <ReminderSettings accessToken={props.accessToken} notify={props.notify} />

      <Section id="settings-people" title="Cardholders" hint={<>Initials label each card, like your 1Password entries: biz plat HK7 is that person&apos;s 7th biz plat.</>}>
        <div className="settings-list">
          {portfolio.people.map((item) => <PersonRow key={item.id} person={item} onSave={props.onSavePerson} />)}
        </div>
        <AddForm className="inline-actions" onAdd={addPerson} button="Add" ready={!!person.trim()}>
          <input className="search" aria-label="New cardholder name" placeholder="Add a cardholder" value={person} onChange={(event) => setPerson(event.target.value)} />
        </AddForm>
      </Section>

      <Section title="Who can sign in">
        <div className="settings-list">
          {membership.members.map((member) => <div key={member.email} className="settings-row"><span className="grow">{member.email}</span><span className="tag">{member.role === "owner" ? "Owner" : "Can edit"}</span></div>)}
          {membership.invitations.map((item) => <div key={item.email} className="settings-row"><span className="grow">{item.email}</span><span className="tag info">Invited</span></div>)}
        </div>
        {membership.role === "owner" && (
          <AddForm className="inline-actions" onAdd={sendInvite} button="Invite" ready={/^\S+@\S+\.\S+$/.test(invite.trim())}>
            <input className="search" type="email" aria-label="Email to invite" placeholder="Invite by email" value={invite} onChange={(event) => setInvite(event.target.value)} />
          </AddForm>
        )}
      </Section>

      <AgentSettings context={props.context} notify={props.notify} />

      <Section title="Export" hint={membership.googleSheet ? "The Google Sheet copy also updates a few seconds after every change." : "A read-only Google Sheet copy can be turned on; see the README."}>
        <div className="inline-actions">
          <button type="button" className="btn small" onClick={() => exportCsv("tracker")}>Tracker CSV</button>
          <button type="button" className="btn small" onClick={() => exportCsv("credits")}>Credits CSV</button>
          <button type="button" className="btn small" onClick={() => exportCsv("stats")}>Stats CSV</button>
          {membership.googleSheet && (
            <button type="button" className="btn small" disabled={syncing} onClick={() => { setSyncing(true); void props.onSyncSheet().finally(() => setSyncing(false)); }}>{syncing ? "Updating…" : "Update Google Sheet"}</button>
          )}
        </div>
      </Section>

      <Section title="Account">
        <div className="settings-row"><span className="grow">Signed in as {membership.email}</span><button type="button" className="btn small" onClick={() => void props.onSignOut()}>Sign out</button></div>
      </Section>
    </Drawer>
  );
}
