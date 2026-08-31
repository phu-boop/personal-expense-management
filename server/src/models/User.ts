import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  tenantId?: mongoose.Types.ObjectId;
  // role
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    avatar: { type: String },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    // role
  },
  { timestamps: true }
);

UserSchema.index({ tenantId: 1, email: 1 });

export default mongoose.model<IUser>('User', UserSchema);
