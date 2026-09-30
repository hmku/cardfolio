"use client";

import { useEffect, useState, type FormEvent } from "react";
import * as data from "../lib/data";

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/** Settings → Agents: keys that let an AI agent read and update Cardfolio over MCP, and what agents changed. */
export function AgentSettings({ context, notify }: { context: data.Context; notify: (text: string, error?: boolean) => void }) {
  const [keys, setKeys] = useState<data.AgentKey[] | null>(null);
  const [changes, setChanges] = useState<data.ChangeLogEntry[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    let active = true;
    Promise.all([data.listAgentKeys(context), data.recentChanges(context)]).then(([nextKeys, nextChanges]) => {
      if (!active) return;
      setKeys(nextKeys);
      setChanges(nextChanges);
    }, (reason) => {
      if (!active) return;
      setKeys([]);
      notify(reason instanceof Error ? reason.message : "Couldn't load agent keys", true);
    });
    return () => { active = false; };
  }, [context, notify, version]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      setCreated(await data.createAgentKey(context, name));
      setName("");
      refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't create the key", true);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: data.AgentKey) => {
    try {
      await data.revokeAgentKey(context, key.id);
      notify(`Revoked ${key.name}`);
      refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't revoke the key", true);
    }
  };

  const copy = (value: string) => void navigator.clipboard?.writeText(value).then(() => notify("Copied"), () => notify("Couldn't copy; select it and copy by hand", true));
  const active = (keys || []).filter((key) => !key.revokedAt);

  return (
    <section className="fieldset settings-section" id="settings-agents">
      <h3>Agents</h3>
      <p className="hint">
        An agent key lets an AI assistant (Claude or any MCP client) read your cards and record new cards, approvals,
        product changes, closures and credits for you. Connect it to <code>{endpoint}</code>. Every change it makes is listed below.
      </p>

      {created && (
        <div className="inline-form agent-key-new" role="status">
          <strong>Copy this key now. It won&apos;t be shown again.</strong>
          <code className="agent-key">{created}</code>
          <div className="inline-actions">
            <button type="button" className="btn small primary" onClick={() => copy(created)}>Copy key</button>
            <button type="button" className="btn small" onClick={() => copy(`claude mcp add --transport http cardfolio ${endpoint} --header "Authorization: Bearer ${created}"`)}>Copy Claude Code command</button>
            <button type="button" className="btn small" onClick={() => setCreated(null)}>Done</button>
          </div>
        </div>
      )}

      <div className="settings-list">
        {keys === null && <p className="hint">Loading…</p>}
        {active.map((key) => (
          <div key={key.id} className="settings-row">
            <span className="grow">{key.name}<small>{key.prefix}… · last used {when(key.lastUsedAt)}</small></span>
            <button type="button" className="btn small danger" onClick={() => void revoke(key)}>Revoke</button>
          </div>
        ))}
      </div>
      <form className="inline-actions" onSubmit={create}>
        <input className="search" aria-label="Agent key name" placeholder="Name, e.g. Claude email scan" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="btn small" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create key"}</button>
      </form>

      {changes.length > 0 && (
        <>
          <h4 className="agent-changes-title">Recent agent changes</h4>
          <ul className="agent-changes">
            {changes.map((change) => (
              <li key={change.id}>
                <span>{change.summary}</span>
                <small>{when(change.createdAt)} · {change.actor.replace(/^agent:/, "")}{change.source ? ` · ${change.source}` : ""}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
