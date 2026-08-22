import { TransactionType } from '../models/Transaction';

export interface BalanceChange {
  balanceBefore: number;
  balanceAfter: number;
}

export const calculateBalanceChange = (
  balanceBefore: number,
  type: TransactionType,
  amount: number,
): BalanceChange => {
  const balanceAfter = type === TransactionType.INCOME
    ? balanceBefore + amount
    : balanceBefore - amount;

  if (balanceAfter < 0) {
    throw new Error('Insufficient balance in wallet');
  }

  return { balanceBefore, balanceAfter };
};