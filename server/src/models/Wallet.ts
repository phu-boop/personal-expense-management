import mongoose, { Document, Schema } from 'mongoose';

export interface IWallet extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalance: mongoose.Types.Decimal128;
  initialBalanceDate: Date;
  currentBalance: mongoose.Types.Decimal128;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<IWallet>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    accountNumber: { type: String },
    initialBalance: { type: Schema.Types.Decimal128, required: true, default: 0 },
    initialBalanceDate: { type: Date, required: true },
    currentBalance: { type: Schema.Types.Decimal128, required: true, default: 0 },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

WalletSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
WalletSchema.index({ tenantId: 1, userId: 1, name: 1 });
WalletSchema.index({ tenantId: 1, userId: 1, accountNumber: 1 });

export const Wallet = mongoose.model<IWallet>('Wallet', WalletSchema);
export default Wallet;
