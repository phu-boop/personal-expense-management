import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

import config from '../config';
import Tenant from '../models/Tenant';
import User from '../models/User';

const GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID?.trim();
const JWT_SECRET = config.JWT_SECRET?.trim();

if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('your-google-client-id-here') || GOOGLE_CLIENT_ID.includes('demo-google-client-id')) {
  console.warn('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID with a real client ID before sign-in works.');
}

if (!JWT_SECRET || JWT_SECRET.includes('replace_with_') || JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET is missing or insecure. Set a real 32+ character secret before starting the app.');
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export async function loginWithGoogle(googleToken: string) {
  if (!googleToken) {
    throw new Error('Missing Google token');
  }

  const ticket = await client.verifyIdToken({
    idToken: googleToken,
    audience: GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload || !payload.email) {
    throw new Error('Invalid token payload');
  }

  const { sub: googleId, email, name, picture: avatar } = payload;

  let user = await User.findOne({ googleId });

  if (!user) {
    user = new User({
      googleId,
      email,
      name: name || email.split('@')[0],
      avatar,
    });
    await user.save();
  }

  if (!user.tenantId) {
    const baseName = (user.name || user.email.split('@')[0]).trim();
    const slugBase = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    let tenant;
    let attempts = 0;

    while (!tenant && attempts < 5) {
      const suffix = attempts === 0 ? '' : `-${attempts}`;
      try {
        tenant = await Tenant.create({
          name: `${baseName}'s Workspace`,
          slug: `${slugBase}-${Date.now()}${suffix}`,
          ownerId: user._id,
        });
      } catch (error: any) {
        if (error?.code !== 11000) {
          throw error;
        }
        attempts += 1;
      }
    }

    if (!tenant) {
      throw new Error('Unable to create tenant for user');
    }

    user.tenantId = tenant._id;
    await user.save();
  }

  const sessionToken = jwt.sign(
    { id: user._id, email: user.email, tenantId: user.tenantId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    token: sessionToken,
    user,
  };
}
