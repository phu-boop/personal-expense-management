import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import Tenant, { TenantStatus } from '../models/Tenant';
import User, { UserRole } from '../models/User';

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const JWT_SECRET = process.env.JWT_SECRET?.trim();

if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('your-google-client-id-here')) {
  throw new Error(
    'GOOGLE_CLIENT_ID is required and must match the Google OAuth client ID used by the frontend. ' +
      'Update server/.env so it equals the same value as VITE_GOOGLE_CLIENT_ID.'
  );
}

if (!JWT_SECRET || JWT_SECRET.includes('replace_with_')) {
  throw new Error(
    'JWT_SECRET is required and should be a real secret value for local/dev usage. Update server/.env with a secure random string.'
  );
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
