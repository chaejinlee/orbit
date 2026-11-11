/** Amounts are integers in the currency's minor unit (cents, yen, won...). */
export interface Money {
  amountMinor: number;
  currency: string;
}

export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return true;
  }
}

export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function toMinor(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyFractionDigits(currency));
}

export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyFractionDigits(currency);
}

export function formatMoney(money: Money, locale = 'en'): string {
  const digits = currencyFractionDigits(money.currency);
  const major = toMajor(money.amountMinor, money.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
}

export interface CostSummary {
  /** Currency of the total: the budget's when given, else the first priced item's. */
  currency: string | null;
  knownTotalMinor: number;
  /** Items without a cost estimate. */
  unknownCount: number;
  /** Items priced in another currency. Never converted: we have no trustworthy rate. */
  mismatchedCount: number;
}

export function summarizeCosts(
  items: ReadonlyArray<{ costMinor: number | null; costCurrency: string | null }>,
  currency: string | null,
): CostSummary {
  let target = currency;
  let knownTotalMinor = 0;
  let unknownCount = 0;
  let mismatchedCount = 0;
  for (const item of items) {
    if (item.costMinor == null || item.costCurrency == null) {
      unknownCount += 1;
      continue;
    }
    target ??= item.costCurrency;
    if (item.costCurrency !== target) {
      mismatchedCount += 1;
      continue;
    }
    knownTotalMinor += item.costMinor;
  }
  return { currency: target, knownTotalMinor, unknownCount, mismatchedCount };
}
