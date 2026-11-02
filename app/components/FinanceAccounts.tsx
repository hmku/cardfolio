"use client";

import type { Range } from "../lib/core/investments";
import { RANGES } from "../lib/core/investments";
import type { Person, Portfolio } from "../lib/core/model";
import type { BankAccount } from "../lib/finance-data";
import { splitMask } from "../lib/presentation/account-labels";

export { bankAccountKind } from "../lib/presentation/account-labels";

/** Shared pieces of the Accounts and Investments pages: owners, account kinds and the filter row. */

/** The account's owner: set on the bank account, else the linked card's cardholder. */
export function bankAccountOwner(portfolio: Portfolio, account: BankAccount) {
  if (account.personId !== null) return account.personId;
  return account.cardAccountId !== null ? portfolio.account(account.cardAccountId)?.personId ?? null : null;
}

/** The balance a bank account counts with: the current balance, else the available one (null when neither is reported). */
export function bankBalanceCents(account: Pick<BankAccount, "currentCents" | "availableCents">) {
  return account.currentCents ?? account.availableCents;
}

/** An account label with its last digits ("··1234") kept together, so they never wrap apart from each other. */
export function AccountName({ label }: { label: string }) {
  const { name, mask } = splitMask(label);
  return mask ? <>{name} <span className="acct-mask">{mask}</span></> : <>{label}</>;
}

/** Everyone (null) or one person's id. */
export type OwnerFilter = number | null;

export function OwnerButtons({ people, value, onChange }: { people: Person[]; value: OwnerFilter; onChange: (value: OwnerFilter) => void }) {
  if (people.length < 2) return null;
  return (
    <div className="seg" role="group" aria-label="Whose accounts">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>Everyone</button>
      {people.map((person) => (
        <button key={person.id} type="button" aria-pressed={value === person.id} onClick={() => onChange(person.id)}>{person.name.split(/\s+/)[0]}</button>
      ))}
    </div>
  );
}

export function RangeButtons({ value, onChange }: { value: Range; onChange: (value: Range) => void }) {
  return (
    <div className="seg" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <button key={range.value} type="button" aria-pressed={value === range.value} onClick={() => onChange(range.value)}>{range.label}</button>
      ))}
    </div>
  );
}

/** A compact owner picker (No owner = shared). Saves on change. */
export function OwnerSelect({ people, value, onChange, label, className }: { people: Person[]; value: number | null; onChange: (value: number | null) => void; label: string; className?: string }) {
  return (
    <select className={className} aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Shared</option>
      {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select>
  );
}
