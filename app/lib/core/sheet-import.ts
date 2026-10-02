import { creditPeriod } from "./credits.ts";
import { daysBetween, isoDate, parseDate } from "./dates.ts";
import type { AccountStatus, BonusUnit, Cadence, HoldingChange, Kind, OpenedVia } from "./model.ts";

/** One row of the sheet's tracker tab. */
export type SheetTrackerRow = {
  who: string;
  card: string;
  kind?: string | null;
  idx?: number | string | null;
  applied?: string | null;
  approved?: string | null;
  how?: string | null;
  offer?: string | null;
  af?: number | string | null;
  sub?: boolean | string | null;
  closed?: string | null;
  closedHow?: string | null;
};

/** One row of the sheet's credits tab. `cur` is the current-year column, e.g. "7/8" or "h2 4/9". */
export type SheetCreditRow = { card: string; credit: string; amount: number | string; freq: string; cur?: string | null };

export type CatalogEntry = { name: string; issuer: string; kind: Kind };

/** Sheet short names → card types. Unknown names are imported as-is. */
export const PRODUCT_CATALOG: Record<string, CatalogEntry> = {
  "aa aviator": { name: "AAdvantage Aviator Red", issuer: "Barclays", kind: "personal" },
  "aa biz": { name: "AAdvantage Aviator Business", issuer: "Barclays", kind: "business" },
  "aa mileup": { name: "AAdvantage MileUp", issuer: "Citi", kind: "personal" },
  "al biz": { name: "Alaska Airlines Business", issuer: "Bank of America", kind: "business" },
  "amex gold": { name: "Amex Gold", issuer: "American Express", kind: "personal" },
  "amex plat": { name: "Amex Platinum", issuer: "American Express", kind: "personal" },
  "bbp": { name: "Blue Business Plus", issuer: "American Express", kind: "business" },
  "biz gold": { name: "Amex Business Gold", issuer: "American Express", kind: "business" },
  "biz green": { name: "Amex Business Green", issuer: "American Express", kind: "business" },
  "biz plat": { name: "Amex Business Platinum", issuer: "American Express", kind: "business" },
  "bonvoy biz": { name: "Marriott Bonvoy Business", issuer: "American Express", kind: "business" },
  "cff": { name: "Chase Freedom Flex", issuer: "Chase", kind: "personal" },
  "cfu": { name: "Chase Freedom Unlimited", issuer: "Chase", kind: "personal" },
  "cic": { name: "Chase Ink Cash", issuer: "Chase", kind: "business" },
  "citi aa biz": { name: "Citi AAdvantage Business", issuer: "Citi", kind: "business" },
  "citi custom cash": { name: "Citi Custom Cash", issuer: "Citi", kind: "personal" },
  "citi premier": { name: "Citi Strata Premier", issuer: "Citi", kind: "personal" },
  "citi strata elite": { name: "Citi Strata Elite", issuer: "Citi", kind: "personal" },
  "ciu": { name: "Chase Ink Unlimited", issuer: "Chase", kind: "business" },
  "csp": { name: "Chase Sapphire Preferred", issuer: "Chase", kind: "personal" },
  "csr": { name: "Chase Sapphire Reserve", issuer: "Chase", kind: "personal" },
  "delta biz gold": { name: "Delta Gold Business", issuer: "American Express", kind: "business" },
  "ha biz": { name: "Hawaiian Airlines Business", issuer: "Barclays", kind: "business" },
  "hh base": { name: "Hilton Honors", issuer: "American Express", kind: "personal" },
  "hh biz": { name: "Hilton Honors Business", issuer: "American Express", kind: "business" },
  "hh surpass": { name: "Hilton Honors Surpass", issuer: "American Express", kind: "personal" },
  "ibp": { name: "Chase Ink Preferred", issuer: "Chase", kind: "business" },
  "jetblue biz": { name: "JetBlue Business", issuer: "Barclays", kind: "business" },
  "jetblue plus": { name: "JetBlue Plus", issuer: "Barclays", kind: "personal" },
  "redcard": { name: "Target RedCard", issuer: "Target", kind: "other" },
  "united biz": { name: "United Business", issuer: "Chase", kind: "business" },
  "united explorer": { name: "United Explorer", issuer: "Chase", kind: "personal" },
  "united gateway": { name: "United Gateway", issuer: "Chase", kind: "personal" },
  "venture": { name: "Capital One Venture", issuer: "Capital One", kind: "personal" },
  "venture x": { name: "Capital One Venture X", issuer: "Capital One", kind: "personal" },
  "wyndham biz": { name: "Wyndham Business", issuer: "Barclays", kind: "business" },
};

/** Names the sheet uses in "downgraded to …" notes or the credits tab for a catalog slug. */
const ALIASES: Record<string, string> = {
  "gateway": "united gateway",
  "custom cash": "citi custom cash",
  "strata premier": "citi premier",
  "vx": "venture x",
};

const CREDIT_NAMES: Record<string, string> = {
  "airline": "Airline fee", "dell": "Dell", "fhr": "Fine Hotels", "wireless credit": "Wireless", "hilton": "Hilton",
  "clear": "CLEAR", "office supply credit": "Office supply", "delta stays": "Delta Stays", "travel": "Travel",
  "chase dining": "Dining", "stubhub": "StubHub", "edit": "The Edit", "c1 portal": "Travel portal",
  "citi portal": "Travel portal", "hotel credit": "Hotel",
};
const LOW_PRIORITY_CREDITS = new Set(["wireless credit", "office supply credit", "clear"]);

export type ImportedHolding = {
  productSlug: string;
  number: number | null;
  startedOn: string;
  endedOn: string | null;
  change: HoldingChange;
  annualFeeCents: number;
  sourceRow: number | null;
};

export type ImportedAccount = {
  key: number;
  person: string;
  appliedOn: string | null;
  approvedOn: string | null;
  openedVia: OpenedVia;
  status: AccountStatus;
  closedOn: string | null;
  bonus: { amount: number; unit: BonusUnit; spendCents: number | null; months: number } | null;
  bonusEarned: boolean;
  note: string | null;
  sourceRow: number;
  holdings: ImportedHolding[];
};

export type ImportedCredit = {
  productSlug: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  remind: boolean;
  sort: number;
  /** Guessed from the sheet's count: holdings (account key + holding index) marked used or not enrolled. */
  used: Array<{ accountKey: number; holdingIndex: number; periodKey: string }>;
  optOuts: Array<{ accountKey: number; holdingIndex: number }>;
};

export type ImportPlan = {
  people: string[];
  /** Initials used in card labels, inferred from notes like "downgraded to cff hk1". */
  personCodes: Record<string, string>;
  products: Array<{ slug: string; name: string; shortName: string | null; issuer: string; kind: Kind; annualFeeCents: number }>;
  accounts: ImportedAccount[];
  credits: ImportedCredit[];
  warnings: string[];
};

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const titleCase = (value: string) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());

function normalizeSlug(value: string) {
  const slug = lower(value).replace(/\s+/g, " ");
  return ALIASES[slug] || slug;
}

function toDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function toCents(value: unknown) {
  const number = Number(clean(value).replace(/[$,]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function toBool(value: unknown) {
  return value === true || lower(value) === "true";
}

/** Parses the sheet's "175k / 12k / 6mo" shorthand. Returns the leftover text when it can't be fully parsed. */
export function parseOffer(offer: unknown) {
  const raw = clean(offer);
  if (!raw || raw === "-" || lower(raw) === "nll") return { bonus: null, leftover: null };
  const parts = raw.split("/").map((part) => part.trim().toLowerCase());
  const head = parts[0];
  let amount: number | null = null;
  let unit: BonusUnit = "points";
  let match: RegExpExecArray | null;
  if ((match = /^\$(\d+(?:\.\d+)?)(k?)/.exec(head))) { amount = Number(match[1]) * (match[2] ? 1000 : 1); unit = "cash"; }
  else if ((match = /^(\d+(?:\.\d+)?)k/.exec(head))) amount = Math.round(Number(match[1]) * 1000);
  else if ((match = /^(\d+)\s*fnc/.exec(head))) { amount = Number(match[1]); unit = "nights"; }
  else if ((match = /^(\d+)/.exec(head))) amount = Number(match[1]);
  if (!amount) return { bonus: null, leftover: raw };
  const spendText = (parts[1] || "").replace(/[$,\s]/g, "");
  const spend = /^\d+(\.\d+)?k$/.test(spendText) ? Math.round(parseFloat(spendText) * 1000) : /^\d+$/.test(spendText) ? Number(spendText) : null;
  const months = /(\d+)\s*mo/.exec(parts[2] || "");
  const fullyParsed = match && match[0].length === head.length;
  return {
    bonus: { amount, unit, spendCents: spend === null ? null : spend * 100, months: months ? Number(months[1]) : 3 },
    leftover: fullyParsed ? null : raw,
  };
}

function openedVia(how: string): OpenedVia {
  if (how === "referred" || how === "referral") return "referral";
  if (how === "nll") return "nll_offer";
  if (how === "downgraded" || how === "upgraded") return "product_change";
  return "applied";
}

type Row = {
  sourceRow: number;
  person: string;
  slug: string;
  number: number | null;
  applied: string | null;
  approved: string | null;
  how: string;
  offer: string;
  feeCents: number;
  earned: boolean;
  closed: string | null;
  closedHow: string;
};

const PRODUCT_CHANGE_NOTE = /^(downgraded|upgraded) to (.+)$/i;

/** Maps the note "downgraded to biz green hk2" to a slug, ignoring the card number. */
function changeTarget(closedHow: string) {
  const match = PRODUCT_CHANGE_NOTE.exec(closedHow);
  if (!match) return null;
  const text = match[2].toLowerCase().replace(/\b(hk|sl)\d+\b/g, "").replace(/\s+/g, " ").trim();
  const slug = normalizeSlug(text);
  const known = Object.keys(PRODUCT_CATALOG).find((key) => key === slug) || Object.keys(PRODUCT_CATALOG).find((key) => key.endsWith(slug));
  return { direction: match[1].toLowerCase() === "downgraded" ? "downgrade" as const : "upgrade" as const, slug: known || slug };
}

function noteFrom(closedHow: string) {
  if (!closedHow || /^(closed|declined)$/i.test(closedHow) || PRODUCT_CHANGE_NOTE.test(closedHow) || /^(downgraded|upgraded) from /i.test(closedHow)) return null;
  return closedHow;
}

/**
 * Turns the tracker and credits tabs into accounts with product histories.
 * Product-change rows ("downgraded", "upgraded") are linked to the row they
 * came from by person, date and the "downgraded to …" note.
 */
export function planSheetImport(trackerRows: SheetTrackerRow[], creditRows: SheetCreditRow[], today: Date): ImportPlan {
  const warnings: string[] = [];
  const rows: Row[] = trackerRows
    .map((row, index) => ({
      sourceRow: index + 2,
      person: titleCase(lower(row.who)),
      slug: normalizeSlug(clean(row.card)),
      number: Number.isFinite(Number(row.idx)) && clean(row.idx) !== "" ? Number(row.idx) : null,
      applied: toDate(row.applied),
      approved: toDate(row.approved),
      how: lower(row.how) || "applied",
      offer: clean(row.offer),
      feeCents: toCents(row.af),
      earned: toBool(row.sub),
      closed: toDate(row.closed),
      closedHow: clean(row.closedHow),
    }))
    .filter((row) => row.slug && row.person);

  const isChange = (row: Row) => (row.how === "downgraded" || row.how === "upgraded") && Boolean(row.approved);
  const nextRow = new Map<number, Row>();
  const linked = new Set<number>();

  // Link each product-change row to the row whose closing note points at it.
  for (const row of rows.filter(isChange).sort((left, right) => String(left.approved).localeCompare(String(right.approved)))) {
    const direction = row.how === "downgraded" ? "downgrade" : "upgrade";
    const candidates = rows
      .filter((source) => source.person === row.person && source.closed && !nextRow.has(source.sourceRow) && source.sourceRow !== row.sourceRow)
      .map((source) => ({ source, target: changeTarget(source.closedHow), gap: Math.abs(daysBetween(parseDate(source.closed)!, parseDate(row.approved)!)) }))
      .filter(({ target, gap }) => target && target.slug === row.slug && gap <= 14)
      .sort((left, right) => left.gap - right.gap || Number(right.target!.direction === direction) - Number(left.target!.direction === direction));
    const match = candidates[0];
    if (match) {
      nextRow.set(match.source.sourceRow, row);
      linked.add(row.sourceRow);
      if (match.gap > 0) warnings.push(`Row ${row.sourceRow}: linked to row ${match.source.sourceRow} although the dates differ by ${match.gap} days.`);
    }
  }

  // Build accounts from every row that doesn't continue another one.
  let key = 0;
  const accounts: ImportedAccount[] = [];
  const synthetic: Array<{ account: ImportedAccount; fromSlug: string }> = [];
  for (const root of rows.filter((row) => !linked.has(row.sourceRow))) {
    const chain = [root];
    while (nextRow.has(chain[chain.length - 1].sourceRow)) chain.push(nextRow.get(chain[chain.length - 1].sourceRow)!);
    const last = chain[chain.length - 1];
    const { bonus, leftover } = parseOffer(root.offer);
    const notes = [noteFrom(last.closedHow), leftover ? `Offer: ${leftover}` : null].filter(Boolean);
    const pending = !root.approved && (!root.closed || /pending/i.test(root.closedHow));
    const account: ImportedAccount = {
      key: ++key,
      person: root.person,
      appliedOn: root.applied || root.approved,
      approvedOn: root.approved,
      openedVia: openedVia(root.how),
      status: !root.approved ? (pending ? "pending" : "declined") : last.closed ? "closed" : "open",
      closedOn: pending ? null : last.closed || null,
      bonus,
      bonusEarned: root.earned,
      note: notes.length ? notes.join(" · ").replace(/^pending review$/i, "Pending review") : null,
      sourceRow: root.sourceRow,
      holdings: chain.map((row, index) => ({
        productSlug: row.slug,
        number: row.approved ? row.number : null,
        startedOn: (row.approved || row.applied)!,
        endedOn: index < chain.length - 1 ? chain[index + 1].approved : null,
        change: row.how === "downgraded" ? "downgrade" : row.how === "upgraded" ? "upgrade" : "opened",
        annualFeeCents: row.feeCents,
        sourceRow: row.sourceRow,
      })),
    };
    if (account.openedVia === "product_change") warnings.push(`Row ${root.sourceRow}: ${root.slug} was a product change, but the card it came from isn't in the sheet. Imported as its own account.`);

    // "downgraded to X" with no row for X: the account lives on as X.
    const target = changeTarget(last.closedHow);
    if (target && last.closed && account.status === "closed") {
      account.status = "open";
      account.closedOn = null;
      account.holdings[account.holdings.length - 1].endedOn = last.closed;
      account.holdings.push({ productSlug: target.slug, number: null, startedOn: last.closed, endedOn: null, change: target.direction, annualFeeCents: 0, sourceRow: null });
      synthetic.push({ account, fromSlug: last.slug });
      warnings.push(`Row ${last.sourceRow}: "${last.closedHow}" has no row of its own, so ${account.person}'s account continues as ${target.slug}.`);
    }
    accounts.push(account);
  }

  // An unlinked product change that returns to the card an account came from ("upgraded" back
  // from Gateway to United Explorer) continues that account instead of being a new one.
  for (const account of [...accounts]) {
    if (account.openedVia !== "product_change") continue;
    const first = account.holdings[0];
    const host = synthetic.find(({ account: candidate, fromSlug }) => {
      const current = candidate.holdings[candidate.holdings.length - 1];
      return candidate !== account && candidate.person === account.person && fromSlug === first.productSlug && !current.endedOn && current.startedOn <= first.startedOn;
    });
    if (!host) continue;
    const hostHoldings = host.account.holdings;
    hostHoldings[hostHoldings.length - 1].endedOn = first.startedOn;
    hostHoldings.push(...account.holdings);
    host.account.status = account.status;
    host.account.closedOn = account.closedOn;
    host.account.note = [host.account.note, account.note].filter(Boolean).join(" · ") || null;
    synthetic.splice(synthetic.indexOf(host), 1);
    accounts.splice(accounts.indexOf(account), 1);
    const index = warnings.findIndex((warning) => warning.startsWith(`Row ${account.sourceRow}:`) && warning.includes("isn't in the sheet"));
    if (index >= 0) warnings.splice(index, 1, `Row ${account.sourceRow}: treated as ${account.person}'s ${first.productSlug} coming back from ${hostHoldings[hostHoldings.length - account.holdings.length - 1].productSlug}.`);
    // Anything that followed the returning card may itself have continued as another product.
    const trailing = synthetic.find((entry) => entry.account === account);
    if (trailing) trailing.account = host.account;
  }

  // Card numbers: keep the sheet's, fix duplicates, then number the added holdings.
  const numberKey = (person: string, slug: string) => `${person}|${slug}`;
  const taken = new Map<string, Set<number>>();
  const allHoldings = accounts.flatMap((account) => account.holdings.map((holding) => ({ account, holding })))
    .sort((left, right) => left.holding.startedOn.localeCompare(right.holding.startedOn));
  for (const { account, holding } of allHoldings) {
    if (holding.number === null) continue;
    const set = taken.get(numberKey(account.person, holding.productSlug)) || new Set<number>();
    if (set.has(holding.number)) {
      const replacement = Math.max(...set) + 1;
      warnings.push(`Row ${holding.sourceRow}: ${account.person} already has ${holding.productSlug} #${holding.number}; numbered #${replacement} instead.`);
      holding.number = replacement;
    }
    set.add(holding.number);
    taken.set(numberKey(account.person, holding.productSlug), set);
  }
  for (const { account, holding } of allHoldings) {
    if (holding.number !== null || account.status === "pending" || account.status === "declined") continue;
    const set = taken.get(numberKey(account.person, holding.productSlug)) || new Set<number>();
    holding.number = Math.max(0, ...set) + 1;
    set.add(holding.number);
    taken.set(numberKey(account.person, holding.productSlug), set);
  }

  // Card types, with the most recent fee as the default.
  const slugs = new Set([...accounts.flatMap((account) => account.holdings.map((holding) => holding.productSlug)), ...creditRows.map((row) => normalizeSlug(row.card))]);
  const products = [...slugs].sort().map((slug) => {
    const catalog = PRODUCT_CATALOG[slug];
    const latest = allHoldings.filter(({ holding }) => holding.productSlug === slug && holding.sourceRow !== null).pop();
    if (!catalog) warnings.push(`Card type "${slug}" isn't in the catalog; imported with its sheet name.`);
    return {
      slug,
      name: catalog?.name || titleCase(slug),
      shortName: null,
      issuer: catalog?.issuer || "Other",
      kind: catalog?.kind || "personal",
      annualFeeCents: latest?.holding.annualFeeCents || 0,
    };
  });
  // Added holdings take the card type's current fee.
  for (const { holding } of allHoldings) {
    if (holding.sourceRow === null) holding.annualFeeCents = products.find((product) => product.slug === holding.productSlug)?.annualFeeCents || 0;
  }

  // Credits, with usage guessed from the "used / enrolled" counts in the current-year column.
  const credits: ImportedCredit[] = creditRows.map((row, index) => {
    const rawName = lower(row.credit);
    const productSlug = normalizeSlug(row.card);
    const frequency = lower(row.freq);
    const cadence: Cadence = frequency.includes("month") ? "monthly"
      : frequency.includes("quarter") ? "quarterly"
      : frequency.includes("biannual") || frequency.includes("semi") || frequency.includes("half") ? "semiannual"
      : frequency.includes("anniversary") ? "card_year"
      : "calendar_year";
    const credit: ImportedCredit = {
      productSlug,
      name: CREDIT_NAMES[rawName] || titleCase(rawName),
      amountCents: toCents(row.amount),
      cadence,
      remind: !LOW_PRIORITY_CREDITS.has(rawName),
      sort: index,
      used: [],
      optOuts: [],
    };
    const count = /^(?:(h[12]|q[1-4])\s+)?(\d+)\s*\/\s*(\d+)$/i.exec(lower(row.cur));
    if (!count) return credit;
    const [, label, usedText, totalText] = count;
    const period = creditPeriod(cadence, today, null);
    if (label && label.toUpperCase() !== period.label) return credit;
    const eligible = accounts.flatMap((account) => account.holdings.map((holding, holdingIndex) => ({ account, holding, holdingIndex })))
      .filter(({ account, holding }) => {
        if (holding.productSlug !== productSlug || !account.approvedOn) return false;
        const period = creditPeriod(cadence, today, account.approvedOn);
        const end = holding.endedOn || (account.status === "closed" ? account.closedOn : null);
        if (cadence === "card_year") return account.status === "open" && !holding.endedOn;
        return holding.startedOn <= isoDate(period.end) && (!end || end >= isoDate(period.start));
      })
      .sort((left, right) => left.holding.startedOn.localeCompare(right.holding.startedOn));
    // When the sheet counts fewer cards than are eligible, assume the missing ones are
    // cards that have since been closed or changed, then the newest cards.
    const extra = Math.max(0, eligible.length - Number(totalText));
    const optOutOrder = [...eligible].sort((left, right) =>
      Number(Boolean(right.holding.endedOn || right.account.status !== "open")) - Number(Boolean(left.holding.endedOn || left.account.status !== "open"))
      || right.holding.startedOn.localeCompare(left.holding.startedOn));
    const skipped = new Set(optOutOrder.slice(0, extra));
    const enrolled = eligible.filter((entry) => !skipped.has(entry));
    credit.optOuts = [...skipped].map(({ account, holdingIndex }) => ({ accountKey: account.key, holdingIndex }));
    credit.used = enrolled.slice(0, Number(usedText)).map(({ account, holdingIndex }) => ({
      accountKey: account.key,
      holdingIndex,
      periodKey: creditPeriod(cadence, today, account.approvedOn).key,
    }));
    return credit;
  });

  const people = [...new Set(rows.map((row) => row.person))].sort((left, right) => left.localeCompare(right));
  const personCodes: Record<string, string> = {};
  for (const person of people) {
    const counts = new Map<string, number>();
    for (const row of rows.filter((item) => item.person === person)) {
      for (const match of row.closedHow.toLowerCase().matchAll(/\b([a-z]{2})\d+\b/g)) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    }
    const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    if (best) personCodes[person] = best[0].toUpperCase();
  }
  return { people, personCodes, products, accounts, credits, warnings };
}

/** Converts an import plan into in-memory portfolio rows with the same ids the SQL import assigns. */
export function planToPortfolioData(plan: ImportPlan): import("./model.ts").PortfolioData {
  const personIds = new Map(plan.people.map((name, index) => [name, index + 1]));
  const productIds = new Map(plan.products.map((product, index) => [product.slug, index + 1]));
  const holdingIds = new Map<string, number>();
  const holdings: import("./model.ts").Holding[] = [];
  const accounts = plan.accounts.map((account, index) => {
    account.holdings.forEach((holding, holdingIndex) => {
      const id = holdings.length + 1;
      holdingIds.set(`${account.key}:${holdingIndex}`, id);
      holdings.push({ id, accountId: index + 1, personId: personIds.get(account.person)!, productId: productIds.get(holding.productSlug)!, number: holding.number, startedOn: holding.startedOn, endedOn: holding.endedOn, change: holding.change, annualFeeCents: holding.annualFeeCents, last4: null });
    });
    return { id: index + 1, personId: personIds.get(account.person)!, appliedOn: account.appliedOn, approvedOn: account.approvedOn, openedVia: account.openedVia, status: account.status, closedOn: account.closedOn, bonus: account.bonus, bonusEarned: account.bonusEarned, note: account.note };
  });
  let useId = 0;
  return {
    people: plan.people.map((name, index) => ({ id: index + 1, name, code: plan.personCodes[name] ?? null, email: null, sort: index })),
    products: plan.products.map((product, index) => ({ id: index + 1, ...product })),
    accounts,
    holdings,
    credits: plan.credits.map((credit, index) => ({ id: index + 1, productId: productIds.get(credit.productSlug)!, name: credit.name, amountCents: credit.amountCents, cadence: credit.cadence, remind: credit.remind, mode: "track", startsOn: null, endsOn: null, sort: credit.sort })),
    uses: plan.credits.flatMap((credit, index) => credit.used.map((use) => ({ id: ++useId, creditId: index + 1, holdingId: holdingIds.get(`${use.accountKey}:${use.holdingIndex}`)!, periodKey: use.periodKey, amountCents: credit.amountCents, usedOn: null, recordedBy: "sheet import", source: "import" as const }))),
    optOuts: plan.credits.flatMap((credit, index) => credit.optOuts.map((optOut) => ({ creditId: index + 1, holdingId: holdingIds.get(`${optOut.accountKey}:${optOut.holdingIndex}`)! }))),
    rules: [],
  };
}
