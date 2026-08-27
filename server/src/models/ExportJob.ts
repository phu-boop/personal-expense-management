import mongoose, { Schema, type Document } from 'mongoose';

export type ExportStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface IExportJob extends Document {
  userId: mongoose.Types.ObjectId;
  walletId?: mongoose.Types.ObjectId;
  fromDate?: Date;
  toDate?: Date;
  type: 'PDF' | 'EXCEL';
  status: ExportStatus;
  fileUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const exportJobSchema = new Schema<IExportJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', index: true },
    fromDate: { type: Date },
    toDate: { type: Date },
    type: { type: String, enum: ['PDF', 'EXCEL'], default: 'PDF' },
    status: { type: String, enum: ['PENDING', 'RUNNING', 'DONE', 'FAILED'], default: 'PENDING' },
    fileUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

export const ExportJobModel = mongoose.models.ExportJob || mongoose.model<IExportJob>('ExportJob', exportJobSchema);
