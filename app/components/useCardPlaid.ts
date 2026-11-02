"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { summarizeCardPlaid, type CardPlaidData, type CardPlaidView } from "../lib/core/card-plaid";
import { isoDate } from "../lib/core/dates";
import type { Portfolio } from "../lib/core/model";
import { bonusStatus } from "../lib/core/stats";
import { loadCardPlaidData, type FinanceContext } from "../lib/finance-data";

const HANDLED_KEY = "cardfolio-credit-suggestions-v1";
/** Keep the remembered list short: old transactions fall out of the suggestion window anyway. */
const HANDLED_LIMIT = 500;

function readHandled(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

/**
 * Plaid details for the Cards and Credits tabs: balances, payments due, bonus spend, fee
 * postings and suggested credit uses for linked cards. Null until loaded, and stays null if
 * Plaid isn't set up (missing tables, no access): the pages then look as they did before.
 * Dismissed and accepted suggestions are remembered in this browser.
 */
export function useCardPlaid(context: FinanceContext | null, portfolio: Portfolio | null, today: Date) {
  const [data, setData] = useState<CardPlaidData | null>(null);
  const [handled, setHandled] = useState<string[]>(() => (typeof window === "undefined" ? [] : readHandled()));
  const [version, setVersion] = useState(0);
  const day = isoDate(today);

  // Which purchases to load: open cards in a bonus window with a spend target. A string key so
  // unrelated portfolio reloads don't refetch.
  const windowsKey = useMemo(() => {
    if (!portfolio) return "";
    return JSON.stringify(portfolio.accounts.flatMap((account) => {
      const bonus = bonusStatus(account, today);
      return bonus && account.bonus?.spendCents && account.approvedOn ? [{ accountId: account.id, from: account.approvedOn, to: isoDate(bonus.deadline) }] : [];
    }));
  }, [portfolio, today]);

  // The portfolio only gates the first load; windowsKey carries what matters from it.
  const ready = Boolean(portfolio);
  useEffect(() => {
    if (!context || !ready) return;
    let active = true;
    loadCardPlaidData(context, { today: day, bonusWindows: JSON.parse(windowsKey || "[]") })
      .then((value) => { if (active) setData(value); })
      .catch((reason) => { if (active) console.warn("Card bank details unavailable:", reason); });
    return () => { active = false; };
  }, [context, day, windowsKey, version, ready]);

  useEffect(() => {
    const onFocus = () => setVersion((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const remember = useCallback((key: string) => {
    setHandled((current) => {
      const next = [...current.filter((item) => item !== key), key].slice(-HANDLED_LIMIT);
      try { localStorage.setItem(HANDLED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  const forget = useCallback((key: string) => {
    setHandled((current) => {
      const next = current.filter((item) => item !== key);
      try { localStorage.setItem(HANDLED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  /** Reloads the bank details now, e.g. after linking a card or syncing in Settings. */
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const view = useMemo<CardPlaidView | null>(
    () => (data && portfolio && data.cards.length ? summarizeCardPlaid(portfolio, data, today, new Set(handled)) : null),
    [data, portfolio, today, handled],
  );
  return { view, remember, forget, refresh };
}
