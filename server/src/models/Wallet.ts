import mongoose, { Schema, type Document } from 'mongoose';

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  bankName?: string;
  accountNumber?: string;
  currency: string;
  openingBalance: number;
  openingDate: Date;
  currentBalance: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    bankName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    currency: { type: String, default: 'VND' },
    openingBalance: { type: Number, default: 0 },
    openingDate: { type: Date, required: true },
    currentBalance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const WalletModel = mongoose.models.Wallet || mongoose.model<IWallet>('Wallet', walletSchema);
