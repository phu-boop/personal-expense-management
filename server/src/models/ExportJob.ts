import mongoose, { Document, Schema } from 'mongoose';

export enum ExportJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export type ExportFormat = 'xlsx' | 'pdf';

export interface IExportJob extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  format: ExportFormat;
  filters: {
    walletId?: mongoose.Types.ObjectId;
    startDate: string;
    endDate: string;
  };
  status: ExportJobStatus;
  fileKey?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

const ExportJobSchema = new Schema<IExportJob>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    format: { type: String, enum: ['xlsx', 'pdf'], required: true },
    filters: {
      walletId: { type: Schema.Types.ObjectId, ref: 'Wallet' },
      startDate: { type: String, required: true },
      endDate: { type: String, required: true },
    },
    status: {
      type: String,
      enum: Object.values(ExportJobStatus),
      default: ExportJobStatus.PENDING,
      index: true,
    },
    fileKey: { type: String },
    error: { type: String },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

ExportJobSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export default mongoose.model<IExportJob>('ExportJob', ExportJobSchema);
