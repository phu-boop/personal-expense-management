import mongoose, { Document, Schema } from 'mongoose';

export enum ExportJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export enum ExportFormat {
  CSV = 'CSV',
  XLSX = 'XLSX',
  PDF = 'PDF',
}

export interface IExportJob extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  fromDate: Date;
  toDate: Date;
  format: ExportFormat;
  status: ExportJobStatus;
  fileKey?: string;
  snapshotAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExportJobSchema = new Schema<IExportJob>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    format: { type: String, enum: Object.values(ExportFormat), required: true },
    status: {
      type: String,
      enum: Object.values(ExportJobStatus),
      default: ExportJobStatus.PENDING,
      index: true,
    },
    fileKey: { type: String },
    snapshotAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);

ExportJobSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export const ExportJob = mongoose.model<IExportJob>('ExportJob', ExportJobSchema);
export default ExportJob;
