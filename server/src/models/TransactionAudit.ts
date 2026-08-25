import mongoose, { Schema, type Document } from 'mongoose';

export interface ITransactionAudit extends Document {
  transactionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  changedBy: mongoose.Types.ObjectId;
  changedAt: Date;
  oldValues: {
    walletId?: string;
    amount?: number;
    type?: 'INCOME' | 'EXPENSE';
    category?: string;
    date?: Date;
    note?: string;
    status?: 'ACTIVE' | 'DELETED';
  };
  newValues: {
    walletId?: string;
    amount?: number;
    type?: 'INCOME' | 'EXPENSE';
    category?: string;
    date?: Date;
    note?: string;
    status?: 'ACTIVE' | 'DELETED';
  };
  changeReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionAuditSchema = new Schema<ITransactionAudit>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, default: Date.now },
    oldValues: {
      walletId: { type: Schema.Types.Mixed },
      amount: { type: Number },
      type: { type: String, enum: ['INCOME', 'EXPENSE'] },
      category: { type: String },
      date: { type: Date },
      note: { type: String },
      status: { type: String, enum: ['ACTIVE', 'DELETED'] },
    },
    newValues: {
      walletId: { type: Schema.Types.Mixed },
      amount: { type: Number },
      type: { type: String, enum: ['INCOME', 'EXPENSE'] },
      category: { type: String },
      date: { type: Date },
      note: { type: String },
      status: { type: String, enum: ['ACTIVE', 'DELETED'] },
    },
    changeReason: { type: String, default: 'User edited transaction' },
  },
  { timestamps: true }
);

transactionAuditSchema.index({ transactionId: 1, changedAt: -1 });
transactionAuditSchema.index({ userId: 1, changedAt: -1 });

export const TransactionAuditModel =
  mongoose.models.TransactionAudit ||
  mongoose.model<ITransactionAudit>('TransactionAudit', transactionAuditSchema, 'transaction_audit');
