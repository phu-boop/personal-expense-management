// tenantId chưa được sử dụng ở thời điểm hiện tại,
// nhưng được chuẩn bị sẵn để mở rộng multi-tenant sau này.

import mongoose, { Document, Schema } from 'mongoose';

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface ITenant extends Document {
  name: string;
  slug: string;
  status: TenantStatus;
  ownerId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: Object.values(TenantStatus), default: TenantStatus.ACTIVE },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

TenantSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<ITenant>('Tenant', TenantSchema);
