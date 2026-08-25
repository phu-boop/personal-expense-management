import { signToken } from '../lib/auth.js';
import { userRepository } from '../repositories/userRepository.js';

export const authService = {
  async loginWithGoogle(input: { email?: string; name?: string; googleId?: string; avatarUrl?: string }) {
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim() || 'New User';

    if (!email) {
      throw new Error('Email is required');
    }

    let user = await userRepository.findByEmailOrGoogleId(email, input.googleId);

    if (!user) {
      user = await userRepository.create({
        email,
        name,
        avatarUrl: input.avatarUrl || '',
        googleId: input.googleId || undefined,
        lastLoginAt: new Date(),
      });
    } else {
      user.email = email;
      user.name = name;
      if (input.googleId) user.googleId = input.googleId;
      if (input.avatarUrl) user.avatarUrl = input.avatarUrl;
      user.lastLoginAt = new Date();
      user.isActive = true;
      await user.save();
    }

    const token = signToken({ userId: String(user._id), email: user.email });

    return {
      token,
      user: {
        id: String(user._id),
        _id: String(user._id),
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl || '',
        googleId: user.googleId || null,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  },

  async getCurrentUser(userId: string) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    return {
      id: String(user._id),
      _id: String(user._id),
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl || '',
      googleId: user.googleId || null,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },
};
