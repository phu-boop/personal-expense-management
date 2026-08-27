import { randomUUID } from 'node:crypto';
import type { Transaction, User, Wallet } from '../types.js';

export const users: User[] = [];
export const wallets: Wallet[] = [];
export const transactions: Transaction[] = [];

export const ensureDemoUser = () => {
  if (!users.length) {
    users.push({
      id: 'user-demo',
      email: 'demo@expense.local',
      name: 'Demo User',
      avatarUrl: '',
      googleId: 'demo-google',
      createdAt: new Date().toISOString(),
    });
  }

  if (!wallets.length) {
    wallets.push({
      _id: 'wallet-demo-1',
      userId: 'user-demo',
      name: 'Ví tiền mặt',
      bankName: 'Tiền mặt',
      accountNumber: '',
      currency: 'VND',
      openingBalance: 10000000,
      openingDate: new Date().toISOString(),
      currentBalance: 10000000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
};

export const createWallet = (userId: string, input: Partial<Wallet>) => {
  const wallet: Wallet = {
    _id: randomUUID(),
    userId,
    name: input.name || 'New Wallet',
    bankName: input.bankName || '',
    accountNumber: input.accountNumber || '',
    currency: input.currency || 'VND',
    openingBalance: Number(input.openingBalance || 0),
    openingDate: input.openingDate || new Date().toISOString(),
    currentBalance: Number(input.currentBalance ?? input.openingBalance ?? 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  wallets.push(wallet);
  return wallet;
};

const recalculateWalletBalances = (walletId: string, userId: string) => {
  const wallet = wallets.find((item) => item._id === walletId && item.userId === userId);
  if (!wallet) {
    return;
  }

  const walletTransactions = transactions
    .filter((tx) => tx.userId === userId && tx.walletId === walletId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = wallet.openingBalance;
  for (const tx of walletTransactions) {
    runningBalance += tx.type === 'INCOME' ? tx.amount : -tx.amount;
    tx.balanceAfter = runningBalance;
  }

  wallet.currentBalance = runningBalance;
  wallet.updatedAt = new Date().toISOString();
};

export const createTransaction = (userId: string, walletId: string, payload: Partial<Transaction>) => {
  const wallet = wallets.find((item) => item._id === walletId && item.userId === userId);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const amount = Number(payload.amount || 0);
  const txType = payload.type || 'EXPENSE';
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  if (txType !== 'INCOME' && txType !== 'EXPENSE') {
    throw new Error('Type must be INCOME or EXPENSE');
  }

  const transaction: Transaction = {
    _id: randomUUID(),
    userId,
    walletId,
    type: txType,
    amount,
    category: payload.category || 'Other',
    date: payload.date || new Date().toISOString(),
    note: payload.note || '',
    balanceAfter: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  transactions.push(transaction);
  recalculateWalletBalances(walletId, userId);
  return transaction;
};

export const updateTransaction = (userId: string, transactionId: string, payload: Partial<Transaction>) => {
  const txIndex = transactions.findIndex((item) => item._id === transactionId && item.userId === userId);
  if (txIndex === -1) throw new Error('Transaction not found');

  const current = transactions[txIndex];
  const nextWalletId = payload.walletId || current.walletId;
  const wallet = wallets.find((item) => item._id === nextWalletId && item.userId === userId);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const amount = payload.amount !== undefined ? Number(payload.amount) : current.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const txType = payload.type || current.type;
  if (txType !== 'INCOME' && txType !== 'EXPENSE') {
    throw new Error('Type must be INCOME or EXPENSE');
  }

  const updated: Transaction = {
    ...current,
    ...payload,
    walletId: nextWalletId,
    amount,
    type: txType,
    date: payload.date || current.date,
    category: payload.category || current.category,
    note: payload.note ?? current.note,
    updatedAt: new Date().toISOString(),
  };

  transactions[txIndex] = updated;

  if (current.walletId !== nextWalletId) {
    recalculateWalletBalances(current.walletId, userId);
  }
  recalculateWalletBalances(nextWalletId, userId);

  return updated;
};

export const deleteTransaction = (userId: string, transactionId: string) => {
  const txIndex = transactions.findIndex((item) => item._id === transactionId && item.userId === userId);
  if (txIndex === -1) throw new Error('Transaction not found');

  const [removed] = transactions.splice(txIndex, 1);
  recalculateWalletBalances(removed.walletId, userId);
  return removed;
};
