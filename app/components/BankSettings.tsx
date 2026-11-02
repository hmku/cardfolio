"use client";

import { useCallback, useEffect, useState } from "react";
import { holdingName, type Portfolio } from "../lib/core/model";

type BankAccount = { id: number; name: string; mask: string | null; accountId: number | null; linkSource: "auto" | "manual" | null };
type BankItem = { id: number; institutionName: string; status: "ok" | "reconnect"; errorCode: string | null; addedByEmail: string | null; consentExpiresAt: string | null; accounts: BankAccount[] };
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

/** Settings → Bank connections: connect bank logins through Plaid and link their cards. */
export function BankSettings({ portfolio, accessToken, notify }: { portfolio: Portfolio; accessToken: string; notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<Connections | null>(null);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const call = useCallback(async (path: string, method: string, body?: unknown) => {
    const response = await fetch(path, { method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Something went wrong");
    return payload;
  }, [accessToken]);

  const reload = useCallback(() => call("/api/plaid", "GET").then((value: Connections) => setData(value)), [call]);

  useEffect(() => {
    reload().catch((reason) => notify(reason instanceof Error ? reason.message : "Couldn't load bank connections", true));
  }, [reload, notify]);

  useEffect(() => {
    if (confirm === null) return;
    const timer = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);

  /** Opens Plaid Link: a new connection, or update mode for an existing item. */
  async function openLink(item?: BankItem) {
    setBusy(item?.id ?? "new");
    try {
      const [plaid, { linkToken }] = await Promise.all([loadPlaid(), call("/api/plaid/link-token", "POST", item ? { itemId: item.id } : {})]);
      const handler = plaid.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          handler.destroy();
          const finish = item
            ? call("/api/plaid/items", "PATCH", { itemId: item.id })
            : call("/api/plaid/items", "POST", { publicToken, institution: metadata.institution ? { id: metadata.institution.institution_id, name: metadata.institution.name } : null });
          finish
            .then((result: { found: number; linked: number }) => {
              const unmatched = result.found - result.linked;
              notify(`${item ? "Reconnected" : "Connected"}: ${result.found} card${result.found === 1 ? "" : "s"} found${result.linked ? `, ${result.linked} matched by last digits` : ""}${unmatched > 0 && !item ? `. Pick the card for ${unmatched === 1 ? "the other one" : `the other ${unmatched}`} below.` : ""}`);
              return reload();
            })
            .catch((reason) => notify(reason instanceof Error ? reason.message : "Couldn't connect that bank", true))
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
      notify(reason instanceof Error ? reason.message : "Couldn't start connecting a bank", true);
    }
  }

  async function disconnect(item: BankItem) {
    setConfirm(null);
    setBusy(item.id);
    try {
      await call("/api/plaid/items", "DELETE", { itemId: item.id });
      notify(`Disconnected ${item.institutionName}`);
      await reload();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't disconnect that bank", true);
    } finally {
      setBusy(null);
    }
  }

  async function link(account: BankAccount, value: string) {
    const accountId = value ? Number(value) : null;
    setData((current) => current && { ...current, items: current.items.map((item) => ({ ...item, accounts: item.accounts.map((row) => (row.id === account.id ? { ...row, accountId, linkSource: "manual" } : row)) })) });
    try {
      await call("/api/plaid/accounts", "PATCH", { id: account.id, accountId });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't link that card", true);
      await reload().catch(() => undefined);
    }
  }

  // Cards to pick from: open ones first, then the rest (newest first), never declined applications.
  const cards = portfolio.accounts
    .filter((account) => account.status !== "declined")
    .map((account) => ({ account, holding: portfolio.current(account.id) }))
    .filter((card) => card.holding)
    .sort((left, right) => Number(right.account.status === "open") - Number(left.account.status === "open") || right.holding!.startedOn.localeCompare(left.holding!.startedOn))
    .map(({ account, holding }) => ({
      id: account.id,
      label: `${holdingName(portfolio, holding!, true)}${holding!.last4 ? ` ··${holding!.last4}` : ""}${account.status === "open" ? "" : ` (${account.status})`}`,
    }));
  const linkedElsewhere = (account: BankAccount) => new Set(data?.items.flatMap((item) => item.accounts).filter((row) => row.id !== account.id && row.accountId).map((row) => row.accountId));

  return (
    <section className="fieldset settings-section">
      <h3>Bank connections</h3>
      <p className="hint">
        Connect each bank login through Plaid, then check which card each account belongs to. Cards are matched by their last digits.
        {data?.sandbox && <> <strong>Test mode:</strong> Plaid&apos;s fake banks only (user_good / pass_good).</>}
        {data && !data.sandbox && <> Each new connection uses one of Plaid&apos;s 10 free slots, even after it&apos;s disconnected, so use Reconnect for a login that stops working.</>}
      </p>
      {data && !data.configured && <p className="hint">Plaid isn&apos;t set up on the server yet; see the README.</p>}
      {data?.items.map((item) => (
        <div key={item.id} className="settings-list bank-item">
          <div className="settings-row">
            <span className="grow">
              {item.institutionName}
              <small>{item.addedByEmail ? `Added by ${item.addedByEmail}` : ""}{item.consentExpiresAt ? ` · access ends ${new Date(item.consentExpiresAt).toLocaleDateString()}` : ""}</small>
            </span>
            {item.status === "reconnect" && <span className="tag alert" title={item.errorCode || undefined}>Needs reconnecting</span>}
            <button type="button" className={`btn small${item.status === "reconnect" ? " primary" : ""}`} disabled={busy !== null} onClick={() => void openLink(item)}>Reconnect</button>
            <button type="button" className="btn small danger" disabled={busy !== null} aria-label={confirm === item.id ? `Confirm disconnect ${item.institutionName}` : `Disconnect ${item.institutionName}`}
              onClick={() => (confirm === item.id ? void disconnect(item) : setConfirm(item.id))}>
              {confirm === item.id ? "Sure?" : "Disconnect"}
            </button>
          </div>
          {item.accounts.map((account) => {
            const taken = linkedElsewhere(account);
            return (
              <div key={account.id} className="settings-row">
                <span className="grow">{account.name}{account.mask && <span className="last4 num"> ··{account.mask}</span>}{!account.accountId && <small>Not linked to a card</small>}</span>
                <select aria-label={`Card for ${account.name}${account.mask ? ` ending ${account.mask}` : ""}`} value={account.accountId ?? ""} onChange={(event) => void link(account, event.target.value)}>
                  <option value="">Not linked</option>
                  {cards.map((card) => <option key={card.id} value={card.id} disabled={taken.has(card.id)}>{card.label}</option>)}
                </select>
              </div>
            );
          })}
          {item.accounts.length === 0 && <div className="settings-row"><span className="grow"><small>No credit cards found in this login.</small></span></div>}
        </div>
      ))}
      {data?.configured && (
        <div className="inline-actions">
          <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void openLink()}>{busy === "new" ? "Connecting…" : "Connect a bank"}</button>
        </div>
      )}
    </section>
  );
}
