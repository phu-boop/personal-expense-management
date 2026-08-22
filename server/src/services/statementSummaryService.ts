export interface StatementWalletBalanceSource {
  _id: string;
  initialBalance: number;
}

export interface StatementSummaryInput {
  wallets: StatementWalletBalanceSource[];
  openingByWallet: Map<string, number>;
  totalIncome: number;
  totalExpense: number;
}

export interface StatementSummaryResult {
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
}

export function calculateStatementSummary({
  wallets,
  openingByWallet,
  totalIncome,
  totalExpense,
}: StatementSummaryInput): StatementSummaryResult {
  const openingBalance = wallets.reduce(
    (total, wallet) => total + (openingByWallet.get(wallet._id.toString()) ?? wallet.initialBalance),
    0,
  );

  const closingBalance = openingBalance + totalIncome - totalExpense;

  return {
    openingBalance,
    totalIncome,
    totalExpense,
    closingBalance,
  };
}
