import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';
import Tenant from '../models/Tenant';

const router = express.Router();

import config from '../config';

const GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID?.trim() || 'demo-google-client-id.apps.googleusercontent.com';
const JWT_SECRET = config.JWT_SECRET?.trim() || 'demo-dev-secret-change-me-please-change-this-value';

if (!config.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_ID.includes('your-google-client-id-here') || config.GOOGLE_CLIENT_ID.includes('demo-google-client-id')) {
  console.warn('Google OAuth is running in demo mode. Replace GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID with a real client ID for sign-in to work.');
}

if (!config.JWT_SECRET || config.JWT_SECRET.includes('replace_with_') || config.JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET is using a fallback demo value. Replace it with a real secret for secure authentication.');
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);


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
      const tenant = await Tenant.create({
        name: `${name || email.split('@')[0]}'s Workspace`,
        slug: `${(name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`,
        ownerId: undefined as any,
      });

      user = new User({
        googleId,
        email,
        name,
        avatar,
        tenantId: tenant._id,
      });

      tenant.ownerId = user._id;
      await tenant.save();
      await user.save();
    }

    if (!user.tenantId) {
      const tenant = await Tenant.create({
        name: `${user.name || user.email.split('@')[0]}'s Workspace`,
        slug: `${(user.name || user.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`,
        ownerId: user._id,
      });

      user.tenantId = tenant._id;
      await user.save();
    }

    const sessionToken = jwt.sign(
      { id: user._id, email: user.email, tenantId: user.tenantId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token: sessionToken, user });
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
});

export default router;
