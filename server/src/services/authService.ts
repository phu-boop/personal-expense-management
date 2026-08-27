import { signToken } from '../lib/auth.js';
import { userRepository } from '../repositories/userRepository.js';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const authService = {
  async loginWithGoogle(input: { token?: string; email?: string; name?: string; googleId?: string; avatarUrl?: string }) {
    // Accept either a raw id token from Google (input.token) or a pre-parsed payload (email, name,...)
    let payload: any = null;

    if (input.token) {
      try {
        const ticket = await googleClient.verifyIdToken({ idToken: input.token });
        payload = ticket.getPayload();
      } catch (err: any) {
        throw new Error('Invalid Google token');
      }
    }

    const email = (payload?.email || input.email)?.trim().toLowerCase();
    const name = (payload?.name || input.name)?.trim() || 'New User';
    const googleId = payload?.sub || input.googleId;
    const avatarUrl = payload?.picture || input.avatarUrl || '';

    if (!email) {
      throw new Error('Email is required');
    }

    let user = await userRepository.findByEmailOrGoogleId(email, googleId);

    if (!user) {
      user = await userRepository.create({
        email,
        name,
        avatarUrl,
        googleId: googleId || undefined,
        lastLoginAt: new Date(),
      });
    } else {
      user.email = email;
      user.name = name;
      if (googleId) user.googleId = googleId;
      if (avatarUrl) user.avatarUrl = avatarUrl;
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
