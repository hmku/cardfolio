"use client";

import { useCallback, useEffect, useState } from "react";
import { errorText, type ApiCall } from "../lib/api";
import type { Portfolio } from "../lib/core/model";
import { bankAccountKind, bankAccountLabel, cardLabel } from "../lib/presentation/account-labels";
import { AccountName } from "./FinanceAccounts";
import { ConfirmButton } from "./ui";
import { fullDate, syncedAt } from "../lib/presentation/format";

type BankAccount = { id: number; name: string; mask: string | null; type: string | null; subtype: string | null; accountId: number | null; linkSource: "auto" | "manual" | null };
type BankItem = { id: number; institutionName: string; status: "ok" | "reconnect"; errorCode: string | null; addedByEmail: string | null; personId: number | null; consentExpiresAt: string | null; lastSyncedAt: string | null; accounts: BankAccount[] };
type Connections = { configured: boolean; sandbox: boolean; items: BankItem[] };

type LinkMetadata = { institution?: { institution_id?: string; name?: string } | null };
type PlaidLink = { open: () => void; destroy: () => void };
type PlaidGlobal = { create: (config: { token: string; onSuccess: (publicToken: string, metadata: LinkMetadata) => void; onExit: (error: { display_message?: string | null; error_message?: string } | null) => void }) => PlaidLink };

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadPlaid(): Promise<PlaidGlobal> {
  const existing = (window as Window & { Plaid?: PlaidGlobal }).Plaid;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LINK_SCRIPT;
    script.onload = () => {
      const plaid = (window as Window & { Plaid?: PlaidGlobal }).Plaid;
      if (plaid) resolve(plaid); else reject(new Error("Plaid didn't load"));
    };
    script.onerror = () => { script.remove(); reject(new Error("Couldn't reach Plaid. Check your connection and try again.")); };
    document.head.appendChild(script);
  });
}

/**
 * Settings → Bank connections: connect bank logins through Plaid and link their cards.
 * `onChanged` runs after anything that changes the cards' bank details (connect, sync, links).
 */
export function BankSettings({ portfolio, api, notify, onChanged }: { portfolio: Portfolio; api: ApiCall; notify: (text: string, error?: boolean) => void; onChanged?: () => void }) {
  const [data, setData] = useState<Connections | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "bank" | "investments" | "sync" | null>(null);
  // Whose login the next connection is; remembered on this device.
  const [owner, setOwner] = useState<string>(() => {
    try { return localStorage.getItem("cardfolio.plaidOwner") || ""; } catch { return ""; }
  });
  const chooseOwner = (value: string) => {
    setOwner(value);
    try { localStorage.setItem("cardfolio.plaidOwner", value); } catch { /* private mode */ }
  };

  const reload = useCallback(() => api<Connections>("/api/plaid").then((value) => { setData(value); setLoadError(null); }), [api]);
  /** Reloads this list and tells the cards their bank details changed. */
  const changed = () => {
    onChanged?.();
    return reload();
  };

  useEffect(() => {
    reload().catch((reason) => setLoadError(errorText(reason, "Couldn't load bank connections")));
  }, [reload]);

  const retry = () => {
    setLoadError(null);
    reload().catch((reason) => setLoadError(errorText(reason, "Couldn't load bank connections")));
  };

  /** Opens Plaid Link: a new bank or brokerage login, or update mode for an existing item. */
  async function openLink(item?: BankItem, kind: "bank" | "investments" = "bank") {
    setBusy(item?.id ?? kind);
    try {
      const [plaid, { linkToken }] = await Promise.all([loadPlaid(), api<{ linkToken: string }>("/api/plaid/link-token", { method: "POST", body: item ? { itemId: item.id } : { kind } })]);
      const handler = plaid.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          handler.destroy();
          const finish = item
            ? api<{ found: number; linked: number }>("/api/plaid/items", { method: "PATCH", body: { itemId: item.id } })
            : api<{ found: number; linked: number }>("/api/plaid/items", { method: "POST", body: { publicToken, personId: owner ? Number(owner) : null, institution: metadata.institution ? { id: metadata.institution.institution_id, name: metadata.institution.name } : null } });
          finish
            .then((result) => {
              const unmatched = result.found - result.linked;
              notify(`${item ? "Reconnected" : "Connected"}: ${result.found} account${result.found === 1 ? "" : "s"} found${result.linked ? `, ${result.linked} matched by last digits` : ""}${unmatched > 0 && !item ? `. Pick the card for ${unmatched === 1 ? "the other one" : `the other ${unmatched}`} below.` : ""}`);
              return changed();
            })
            .catch((reason) => notify(errorText(reason, "Couldn't connect that bank"), true))
            .finally(() => setBusy(null));
        },
        onExit: (error) => {
          handler.destroy();
          setBusy(null);
          if (error) notify(error.display_message || error.error_message || "Plaid closed with an error", true);
        },
      });
      handler.open();
    } catch (reason) {
      setBusy(null);
      notify(errorText(reason, "Couldn't start connecting a bank"), true);
    }
  }

  /** Pulls new balances and transactions now, for one login or all of them. */
  async function syncNow(item?: BankItem) {
    setBusy(item ? item.id : "sync");
    try {
      const result = await api<{ items: { ok: boolean; error?: string; transactions: { added: number } }[] }>("/api/plaid/sync", { method: "POST", body: item ? { itemId: item.id } : {} });
      const failed = result.items.filter((row) => !row.ok);
      const added = result.items.reduce((sum, row) => sum + (row.transactions?.added || 0), 0);
      if (failed.length) notify(`Synced with problems: ${failed.map((row) => row.error).filter(Boolean).join("; ") || "check the connections below"}`, true);
      else notify(`Synced${added ? `: ${added} new transaction${added === 1 ? "" : "s"}` : ""}`);
      await changed();
    } catch (reason) {
      notify(errorText(reason, "Couldn't sync"), true);
    } finally {
      setBusy(null);
    }
  }

  async function setItemOwner(item: BankItem, value: string) {
    setBusy(item.id);
    try {
      const { linked } = await api<{ linked: number }>("/api/plaid/items", { method: "PATCH", body: { itemId: item.id, personId: value ? Number(value) : null } });
      notify(linked ? `Matched ${linked} more card${linked === 1 ? "" : "s"}` : "Saved");
      await changed();
    } catch (reason) {
      notify(errorText(reason, "Couldn't save that"), true);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(item: BankItem) {
    setBusy(item.id);
    try {
      await api("/api/plaid/items", { method: "DELETE", body: { itemId: item.id } });
      notify(`Disconnected ${item.institutionName}`);
      await changed();
    } catch (reason) {
      notify(errorText(reason, "Couldn't disconnect that bank"), true);
    } finally {
      setBusy(null);
    }
  }

  async function link(account: BankAccount, value: string) {
    const accountId = value ? Number(value) : null;
    setData((current) => current && { ...current, items: current.items.map((item) => ({ ...item, accounts: item.accounts.map((row) => (row.id === account.id ? { ...row, accountId, linkSource: "manual" } : row)) })) });
    try {
      await api("/api/plaid/accounts", { method: "PATCH", body: { id: account.id, accountId } });
      onChanged?.();
    } catch (reason) {
      notify(errorText(reason, "Couldn't link that card"), true);
      await reload().catch(() => undefined);
    }
  }

  // Cards to pick from: open ones (banks only report open cards), newest first, plus any
  // card already linked so a link to a since-closed card still shows.
  const linkedIds = new Set(data?.items.flatMap((item) => item.accounts.map((row) => row.accountId)));
  const cards = portfolio.accounts
    .filter((account) => account.status === "open" || linkedIds.has(account.id))
    .map((account) => ({ account, holding: portfolio.current(account.id) }))
    .filter((card) => card.holding)
    .sort((left, right) => Number(right.account.status === "open") - Number(left.account.status === "open") || right.holding!.startedOn.localeCompare(left.holding!.startedOn))
    .map(({ account, holding }) => ({
      id: account.id,
      label: `${cardLabel(portfolio, holding!, { full: true })}${account.status === "open" ? "" : ` (${account.status})`}`,
    }));
  // Plaid's own name for the account ("Plaid Credit Card ··1234"), so it can be checked against the card picked for it.
  const plaidName = (account: BankAccount) => bankAccountLabel({ ...account, cardAccountId: null, institutionName: null }, portfolio);
  const linkedElsewhere = (account: BankAccount) => new Set(data?.items.flatMap((item) => item.accounts).filter((row) => row.id !== account.id && row.accountId).map((row) => row.accountId));

  return (
    <section className="fieldset settings-section">
      <h3>Bank connections</h3>
      {!data && !loadError && <p className="hint">Loading bank connections…</p>}
      {loadError && !data && (
        <div className="inline-actions">
          <p className="hint" role="alert">{loadError}</p>
          <button type="button" className="btn small" onClick={retry}>Retry</button>
        </div>
      )}
      {data?.configured && <p className="hint">
        Connect each login through Plaid: banks and card issuers with &ldquo;Connect a bank or card&rdquo;, brokerages and retirement accounts with &ldquo;Connect investments&rdquo;. Pick whose login it is first: cards are matched to that person&apos;s Cardfolio cards by card type and last digits. Check each one.
        {data.sandbox && <> <strong>Test mode:</strong> Plaid&apos;s fake banks only (user_good / pass_good).</>}
        {!data.sandbox && <> Each new connection uses one of Plaid&apos;s 10 free slots, even after it&apos;s disconnected, so use Reconnect for a login that stops working.</>}
      </p>}
      {data && !data.configured && <p className="hint">Plaid isn&apos;t set up on the server yet; see the README.</p>}
      {data?.items.map((item) => (
        <div key={item.id} className="settings-list bank-item">
          <div className="settings-row">
            <span className="grow">
              {item.institutionName}
              <small>{[
                item.addedByEmail && `Added by ${item.addedByEmail}`,
                item.consentExpiresAt && `access ends ${fullDate(new Date(item.consentExpiresAt))}`,
                item.lastSyncedAt && `synced ${syncedAt(item.lastSyncedAt)}`,
              ].filter(Boolean).join(" · ")}</small>
            </span>
            <select aria-label={`Whose login is ${item.institutionName}`} value={item.personId ?? ""} disabled={busy !== null} onChange={(event) => void setItemOwner(item, event.target.value)}>
              <option value="">Whose login?</option>
              {portfolio.people.map((person) => <option key={person.id} value={person.id}>{person.name}&apos;s login</option>)}
            </select>
            {item.status === "reconnect" && <span className="tag alert" title={item.errorCode || undefined}>Needs reconnecting</span>}
            {item.status !== "reconnect" && <button type="button" className="btn small" disabled={busy !== null} onClick={() => void syncNow(item)}>{busy === item.id ? "Syncing…" : "Sync"}</button>}
            <button type="button" className={`btn small${item.status === "reconnect" ? " primary" : ""}`} disabled={busy !== null} onClick={() => void openLink(item)}>Reconnect</button>
            <ConfirmButton disabled={busy !== null} label={`Disconnect ${item.institutionName}`} onConfirm={() => void disconnect(item)}>Disconnect</ConfirmButton>
          </div>
          {item.accounts.map((account) => {
            const taken = linkedElsewhere(account);
            if (account.type !== "credit") {
              return (
                <div key={account.id} className="settings-row">
                  <span className="grow"><AccountName label={plaidName(account)} /></span>
                  <span className="tag">{bankAccountKind(account)}</span>
                </div>
              );
            }
            return (
              <div key={account.id} className="settings-row">
                <span className="grow"><AccountName label={plaidName(account)} />{!account.accountId && <small>Not linked to a card</small>}</span>
                <select aria-label={`Card for ${account.name}${account.mask ? ` ending ${account.mask}` : ""}`} value={account.accountId ?? ""} disabled={busy !== null} onChange={(event) => void link(account, event.target.value)}>
                  <option value="">Not linked</option>
                  {cards.map((card) => <option key={card.id} value={card.id} disabled={taken.has(card.id)}>{card.label}</option>)}
                </select>
              </div>
            );
          })}
          {item.accounts.length === 0 && <div className="settings-row"><span className="grow"><small>No accounts found in this login.</small></span></div>}
        </div>
      ))}
      {data?.configured && (
        <div className="inline-actions">
          <select aria-label="Whose login are you connecting" value={owner} onChange={(event) => chooseOwner(event.target.value)}>
            <option value="">Whose login?</option>
            {portfolio.people.map((person) => <option key={person.id} value={person.id}>{person.name}&apos;s</option>)}
          </select>
          <button type="button" className="btn small primary" disabled={busy !== null || !owner} title={owner ? undefined : "Pick whose login it is first"} onClick={() => void openLink(undefined, "bank")}>{busy === "bank" ? "Connecting…" : "Connect a bank or card"}</button>
          <button type="button" className="btn small" disabled={busy !== null || !owner} title={owner ? undefined : "Pick whose login it is first"} onClick={() => void openLink(undefined, "investments")}>{busy === "investments" ? "Connecting…" : "Connect investments"}</button>
          {!!data.items.length && <button type="button" className="btn small" disabled={busy !== null} onClick={() => void syncNow()}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>}
        </div>
      )}
    </section>
  );
}
