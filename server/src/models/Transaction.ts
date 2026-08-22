import mongoose, { Document, Schema } from 'mongoose';

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export interface ITransaction extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number;
  category: string;
  date: Date;
  note?: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    type: { type: String, enum: Object.values(TransactionType), required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    date: { type: Date, required: true, index: true },
    note: { type: String },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true }
);

// Compound index for querying tenant-scoped transactions efficiently
TransactionSchema.index({ tenantId: 1, userId: 1, date: -1, _id: -1 });
TransactionSchema.index({ tenantId: 1, userId: 1, walletId: 1, date: -1, _id: -1 });
TransactionSchema.index({ tenantId: 1, userId: 1, type: 1, date: -1, _id: -1 });
TransactionSchema.index({ tenantId: 1, userId: 1, category: 1, date: -1, _id: -1 });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
