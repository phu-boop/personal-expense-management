import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import Tenant, { TenantStatus } from '../models/Tenant';
import User, { UserRole } from '../models/User';

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || 'demo-google-client-id.apps.googleusercontent.com';
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'demo-dev-secret-change-me-please-change-this-value';

if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.includes('your-google-client-id-here') || process.env.GOOGLE_CLIENT_ID.includes('demo-google-client-id')) {
  console.warn('Google OAuth is running in demo mode. Replace GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID with a real client ID for sign-in to work.');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace_with_') || process.env.JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET is using a fallback demo value. Replace it with a real secret for secure authentication.');
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const ensureTenantForUser = async (user: any) => {
  if (user.tenantId) {
    return user;
  }

  const tenantSlugBase = `${user.email.split('@')[0]}-${Date.now()}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);

  let tenant = await Tenant.findOne({ ownerId: user._id, status: TenantStatus.ACTIVE });

  if (!tenant) {
    tenant = await Tenant.create({
      name: `${user.name}'s workspace`,
      slug: tenantSlugBase || 'workspace',
      ownerId: user._id,
      status: TenantStatus.ACTIVE,
    });
  }

  user.tenantId = tenant._id;
  user.role = UserRole.OWNER;
  await user.save();

  return user;
};

router.post('/google', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Missing Google token' });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      return res.status(400).json({ message: 'Invalid token payload' });
    }

    const { sub: googleId, email, name, picture: avatar } = payload;

    let user = await User.findOne({ googleId });

    if (!user) {
      user = new User({ googleId, email, name, avatar, role: UserRole.OWNER });
      await user.save();
    }

    const persistedUser = await ensureTenantForUser(user);

    if (!persistedUser) {
      return res.status(500).json({ message: 'Unable to create tenant for user' });
    }

    const sessionToken = jwt.sign(
      { id: persistedUser._id, email: persistedUser.email, tenantId: persistedUser.tenantId, role: persistedUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token: sessionToken, user: persistedUser });
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
});

export default router;
