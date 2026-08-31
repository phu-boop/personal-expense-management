import mongoose from 'mongoose';
import Decimal from 'decimal.js';

// Dùng decimal.js để tính toán tiền chính xác,
// tránh sai số floating-point của JavaScript Number.
export type Decimal128 = mongoose.Types.Decimal128;
export type MoneyValue = Decimal128 | Decimal | string;

export const MONEY_DECIMAL_PLACES = 2;

export function toDecimal(value: MoneyValue): Decimal {
  if (value instanceof Decimal) {
    return value;
  }

  if (value instanceof mongoose.Types.Decimal128) {
    return new Decimal(value.toString());
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new Error('Money value cannot be empty');
  }

  return new Decimal(normalized);
}

export function toDecimal128(value: MoneyValue): Decimal128 {
  const rounded = toDecimal(value).toDecimalPlaces(
    MONEY_DECIMAL_PLACES,
    Decimal.ROUND_HALF_UP,
  );

  return mongoose.Types.Decimal128.fromString(
    rounded.toFixed(MONEY_DECIMAL_PLACES),
  );
}

export function addDecimal(a: MoneyValue, b: MoneyValue): Decimal128 {
  return toDecimal128(toDecimal(a).plus(toDecimal(b)));
}

export function subtractDecimal(a: MoneyValue, b: MoneyValue): Decimal128 {
  return toDecimal128(toDecimal(a).minus(toDecimal(b)));
}

export function multiplyDecimal(a: MoneyValue, b: MoneyValue): Decimal128 {
  return toDecimal128(toDecimal(a).times(toDecimal(b)));
}

export function compareDecimal(a: MoneyValue, b: MoneyValue): number {
  return toDecimal(a).cmp(toDecimal(b));
}

export function isNegativeDecimal(value: MoneyValue): boolean {
  return toDecimal(value).isNegative();
}

// Backward-compatible alias for code that expects a Decimal128 factory.
export const decimal = toDecimal128;
