import Decimal from 'decimal.js';

// Transaction effect biểu thị cách một giao dịch làm thay đổi số dư wallet.
// INCOME làm tăng số dư; EXPENSE làm giảm số dư.
export function getTransactionEffect(
  amount: Decimal,
  type: 'INCOME' | 'EXPENSE',
): Decimal {
  return type === 'INCOME' ? amount : amount.negated();
}
