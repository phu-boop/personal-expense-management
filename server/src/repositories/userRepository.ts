import { UserModel } from '../models/User.js';

export const userRepository = {
  async findByEmailOrGoogleId(email?: string, googleId?: string) {
    return UserModel.findOne({
      $or: [
        ...(email ? [{ email: email.trim().toLowerCase() }] : []),
        ...(googleId ? [{ googleId }] : []),
      ],
    }).exec();
  },

  async create(data: { email: string; name: string; avatarUrl?: string; googleId?: string; lastLoginAt?: Date }) {
    return UserModel.create(data);
  },

  async findById(userId: string) {
    return UserModel.findById(userId).lean();
  },
};
