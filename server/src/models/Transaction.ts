import mongoose, { Schema, type Document } from 'mongoose';

export type TransactionType = 'INCOME' | 'EXPENSE';

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number;
  category: string;
  date: Date;
  note?: string;
  balanceBefore: number;
  balanceAfter: number;
  status: 'ACTIVE' | 'DELETED';
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    type: { type: String, enum: ['INCOME', 'EXPENSE'], required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    date: { type: Date, required: true },
    note: { type: String, default: '' },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'DELETED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, walletId: 1, date: -1 });
transactionSchema.index({ userId: 1, walletId: 1, type: 1, date: -1 });

export const TransactionModel = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', transactionSchema);
