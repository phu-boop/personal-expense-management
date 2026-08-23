import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import Wallet from '../models/Wallet';
import { calculateBalanceChange } from './balanceService';
import { CreateTransactionInput } from '../validators/transactionValidator';

export class WalletNotFoundError extends Error {}

const transactionSort = { date: 1, createdAt: 1, _id: 1 } as const;

export const createTransaction = async (
  tenantId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  input: CreateTransactionInput,
) => {
  const wallet = await Wallet.findOne({ _id: input.walletId, tenantId, userId });
  if (!wallet) {
    throw new WalletNotFoundError('Wallet not found');
  }

  const transaction = await Transaction.create({
    tenantId,
    userId,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    category: input.category,
    date: input.date,
    note: input.note,
    balanceBefore: 0,
    balanceAfter: 0,
  });

  const transactions = await Transaction.find({ walletId: wallet._id, tenantId, userId })
    .sort(transactionSort);

  let balance = wallet.initialBalance;
  for (const currentTransaction of transactions) {
    const change = calculateBalanceChange(
      balance,
      currentTransaction.type,
      currentTransaction.amount,
    );
    currentTransaction.balanceBefore = change.balanceBefore;
    currentTransaction.balanceAfter = change.balanceAfter;
    balance = change.balanceAfter;
    await currentTransaction.save();
  }

  wallet.currentBalance = balance;
  await wallet.save();

  return transactions.find((currentTransaction) => currentTransaction._id.equals(transaction._id));
};