import mongoose, { Document, Schema } from 'mongoose';

export enum BalanceSnapshotStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
}

export interface IBalanceSnapshot extends Document {
  tenantId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  snapshotAt: Date;
  balance: mongoose.Types.Decimal128;
  lastTransactionDate?: Date;
  lastTransactionCreatedAt?: Date;
  lastTransactionId?: mongoose.Types.ObjectId;
  status: BalanceSnapshotStatus;
  invalidatedAt?: Date;
  invalidatedBy?: mongoose.Types.ObjectId;
  meta?: any;
  createdAt: Date;
  updatedAt: Date;
}

const BalanceSnapshotSchema = new Schema<IBalanceSnapshot>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    snapshotAt: { type: Date, required: true, default: () => new Date() },
    balance: { type: Schema.Types.Decimal128, required: true },
    lastTransactionDate: { type: Date },
    lastTransactionCreatedAt: { type: Date },
    lastTransactionId: { type: Schema.Types.ObjectId },
    invalidatedAt: { type: Date },
    invalidatedBy: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    meta: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: Object.values(BalanceSnapshotStatus),
      default: BalanceSnapshotStatus.VALID,
      index: true,
    },
  },
  { timestamps: true }
);

BalanceSnapshotSchema.index({ tenantId: 1, walletId: 1, status: 1, snapshotAt: -1 });
BalanceSnapshotSchema.index({ tenantId: 1, walletId: 1, status: 1, lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 });

export const BalanceSnapshot = mongoose.model<IBalanceSnapshot>('BalanceSnapshot', BalanceSnapshotSchema);
export default BalanceSnapshot;
