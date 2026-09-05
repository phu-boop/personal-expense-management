import mongoose, { Document, Schema } from 'mongoose';

export enum CategoryType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export interface ICategory extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  type: CategoryType;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: Object.values(CategoryType), required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CategorySchema.index({ tenantId: 1, userId: 1, type: 1, name: 1 }, { unique: false });
CategorySchema.index({ tenantId: 1, userId: 1, isDefault: 1 });

export const Category = mongoose.model<ICategory>('Category', CategorySchema);
export default Category;
