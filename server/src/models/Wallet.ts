import mongoose, { Document, Schema } from 'mongoose';

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalance: number;
  currentBalance: number;
  startDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    accountNumber: { type: String },
    initialBalance: { type: Number, required: true, default: 0 },
    currentBalance: { type: Number, required: true, default: 0 },
    startDate: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IWallet>('Wallet', WalletSchema);
