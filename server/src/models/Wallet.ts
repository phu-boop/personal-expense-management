import mongoose, { Document, Schema } from 'mongoose';

export interface IWallet extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalance: number;
  currentBalance: number;
  colorTheme?: string;
  startDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<IWallet>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    accountNumber: { type: String },
    initialBalance: { type: Number, required: true, default: 0 },
    currentBalance: { type: Number, required: true, default: 0 },
    colorTheme: { type: String, default: 'emerald' },
    startDate: { type: Date, required: true },
  },
  { timestamps: true }
);

WalletSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
WalletSchema.index({ tenantId: 1, userId: 1, name: 1 });
WalletSchema.index({ tenantId: 1, userId: 1, accountNumber: 1 });

export default mongoose.model<IWallet>('Wallet', WalletSchema);
