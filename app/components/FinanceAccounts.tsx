"use client";

import type { Range } from "../lib/core/investments";
import { RANGES } from "../lib/core/investments";
import type { Person, Portfolio } from "../lib/core/model";
import type { BankAccount } from "../lib/finance-data";

export { bankAccountKind } from "../lib/presentation/account-labels";

/** Shared pieces of the Accounts and Investments pages: owners, account kinds and the filter row. */

/** The account's owner: set on the bank account, else the linked card's cardholder. */
export function bankAccountOwner(portfolio: Portfolio, account: BankAccount) {
  if (account.personId !== null) return account.personId;
  return account.cardAccountId !== null ? portfolio.account(account.cardAccountId)?.personId ?? null : null;
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

/** A sync time like "Nov 2, 9:14 AM", or "never". */
export function syncedAt(value: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
