/**
 * Which Cardfolio account each Plaid account belongs to: the open card whose current
 * product's last digits end with Plaid's mask (Plaid shows up to 4 digits, Amex statements
 * show 5). Only a single match that no other Plaid account has claimed is used; anything
 * else is left for a person to pick.
 */
export function matchPlaidAccounts(
  plaidAccounts: { id: number; mask: string | null }[],
  cards: { accountId: number; last4: string | null }[],
  claimed: Iterable<number> = [],
) {
  const matches = new Map<number, number>();
  const taken = new Set(claimed);
  const candidatesFor = (mask: string) => cards.filter((card) => !!card.last4 && card.last4.endsWith(mask) && !taken.has(card.accountId));
  // Decide every mask against the same set of cards, so the order Plaid lists them in doesn't matter.
  const decided = plaidAccounts.map((account) => {
    const mask = account.mask?.replace(/\D/g, "") || "";
    const candidates = mask.length >= 4 ? candidatesFor(mask) : [];
    return { id: account.id, accountId: candidates.length === 1 ? candidates[0].accountId : null };
  });
  const counts = new Map<number, number>();
  for (const { accountId } of decided) if (accountId !== null) counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  for (const { id, accountId } of decided) {
    if (accountId !== null && counts.get(accountId) === 1) matches.set(id, accountId);
  }
  return matches;
}
