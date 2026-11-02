export type PlaidAccountToMatch = { id: number; mask: string | null; name?: string | null };

/**
 * An open Cardfolio card Plaid accounts can link to. `digits` are its last digits, newest
 * first: the current product's, then earlier products' on the same account (Amex keeps the
 * card number through a downgrade, and older imports may only have the earlier digits).
 */
export type CardToMatch = { accountId: number; digits: string[]; productName?: string | null; personId?: number | null };

// Issuer names and filler words that say nothing about which card it is.
const NOISE = new Set([
  "amex", "american", "express", "chase", "citi", "citibank", "capital", "one", "barclays", "barclaycard",
  "bank", "of", "america", "wells", "fargo", "us", "the", "card", "cards", "credit", "rewards", "visa",
  "mastercard", "signature", "world", "elite", "infinite",
]);

export function cardNameTokens(name: string | null | undefined) {
  return new Set((name || "").toLowerCase().replace(/[®™]/g, "").split(/[^a-z0-9]+/).filter((word) => word && !NOISE.has(word)));
}

/** 2: the same card type ("Business Platinum Card®" / "Amex Business Platinum"), 1: one name contains the other, 0: no match. */
export function cardNameScore(plaidName: string | null | undefined, productName: string | null | undefined) {
  const plaid = cardNameTokens(plaidName);
  const product = cardNameTokens(productName);
  if (!plaid.size || !product.size) return 0;
  const inPlaid = [...product].every((word) => plaid.has(word));
  const inProduct = [...plaid].every((word) => product.has(word));
  return inPlaid && inProduct ? 2 : inPlaid || inProduct ? 1 : 0;
}

/** Keeps the candidates whose card type matches the Plaid name best; all of them if none match by name. */
function narrowByName(candidates: CardToMatch[], name: string | null | undefined) {
  if (!name || candidates.length < 2) return candidates;
  const scored = candidates.map((card) => ({ card, score: cardNameScore(name, card.productName) }));
  const best = Math.max(...scored.map((item) => item.score));
  return best === 0 ? candidates : scored.filter((item) => item.score === best).map((item) => item.card);
}

/**
 * Which Cardfolio account each Plaid account belongs to. A card qualifies when its last
 * digits end with Plaid's mask (Plaid shows up to 4 digits, Amex statements show 5) and,
 * when known, it belongs to the person whose login this is. Several qualifying cards are
 * narrowed by card type (Plaid's account name vs the Cardfolio card type). Without a known
 * person, the login's owner is inferred from the matches that were unambiguous and used to
 * settle the rest. Only a single match no other Plaid account claims is used; anything else
 * is left for a person to pick.
 */
export function matchPlaidAccounts(
  plaidAccounts: PlaidAccountToMatch[],
  cards: CardToMatch[],
  claimed: Iterable<number> = [],
  options: { personId?: number | null } = {},
) {
  const taken = new Set(claimed);
  const available = cards.filter((card) => !taken.has(card.accountId));
  const candidatesFor = (account: PlaidAccountToMatch, personId: number | null | undefined) => {
    const mask = account.mask?.replace(/\D/g, "") || "";
    if (mask.length < 4) return [];
    const byDigits = available.filter((card) => card.digits.some((digits) => digits.endsWith(mask)) && (personId == null || card.personId === personId));
    return narrowByName(byDigits, account.name);
  };

  const decide = (personId: number | null | undefined) => plaidAccounts.map((account) => {
    const candidates = candidatesFor(account, personId);
    return { id: account.id, card: candidates.length === 1 ? candidates[0] : null };
  });

  let decided = decide(options.personId);
  if (options.personId == null) {
    // Infer whose login this is from the clear matches, then use it for the rest.
    const people = new Map<number, number>();
    for (const { card } of decided) if (card?.personId != null) people.set(card.personId, (people.get(card.personId) ?? 0) + 1);
    const [owner] = [...people.entries()].sort((left, right) => right[1] - left[1]);
    const runnerUp = [...people.values()].sort((left, right) => right - left)[1] ?? 0;
    if (owner && owner[1] > runnerUp) {
      const byOwner = decide(owner[0]);
      decided = decided.map((item, index) => (item.card ? item : byOwner[index]));
    }
  }

  // Decide every account against the same set of cards, so Plaid's order doesn't matter,
  // and drop any card two Plaid accounts both landed on.
  const counts = new Map<number, number>();
  for (const { card } of decided) if (card) counts.set(card.accountId, (counts.get(card.accountId) ?? 0) + 1);
  const matches = new Map<number, number>();
  for (const { id, card } of decided) if (card && counts.get(card.accountId) === 1) matches.set(id, card.accountId);
  return matches;
}
