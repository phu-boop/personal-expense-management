import mongoose, { Schema, type Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  googleId?: string;
  name: string;
  avatarUrl?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, trim: true },
    googleId: { type: String, sparse: true, unique: true },
    name: { type: String, required: true },
    avatarUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export const UserModel = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
