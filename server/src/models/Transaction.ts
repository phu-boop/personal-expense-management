import mongoose, { Document, Schema } from 'mongoose';

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export interface ITransaction extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  amount: mongoose.Types.Decimal128;
  type: TransactionType;
  category?: mongoose.Types.ObjectId;
  date: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    type: { type: String, enum: Object.values(TransactionType), required: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    date: { type: Date, required: true },
    note: { type: String },
  },
  { timestamps: true }
);

TransactionSchema.index({ tenantId: 1, walletId: 1, date: 1, createdAt: 1, _id: 1 });
TransactionSchema.index({ tenantId: 1, userId: 1, date: 1, createdAt: 1, _id: 1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
export default Transaction;
