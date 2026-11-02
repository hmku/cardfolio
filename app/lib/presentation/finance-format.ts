/** Money formatting for the finance pages (cents in, always two decimals). */

const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$1,234.56", "−$4.50". */
export function moneyExact(cents: number) {
  const text = exact.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** "$1,235", "−$5": for totals and charts. */
export function moneyWhole(cents: number) {
  const text = whole.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** A transaction amount: "+$1,200.00" for money in, "$4.50" for money out (like most bank apps). */
export function transactionAmount(cents: number) {
  return cents > 0 ? `+${exact.format(cents / 100)}` : exact.format(Math.abs(cents) / 100);
}

