export type TransactionType = 'INCOME' | 'EXPENSE';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  googleId?: string;
  createdAt: string;
}

export interface Wallet {
  _id: string;
  userId: string;
  name: string;
  bankName?: string;
  accountNumber?: string;
  currency: string;
  openingBalance: number;
  openingDate: string;
  currentBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  _id: string;
  userId: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  note?: string;
  balanceAfter: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthPayload {
  userId: string;
  email: string;
}
