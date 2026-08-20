import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';

const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy-client-id');

// Real Google Login
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Missing Google token' });
    }

    // Verify the token with Google
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
      user = new User({ googleId, email, name, avatar });
      await user.save();
    }

    // Sign our own JWT token for the session
    const sessionToken = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({ token: sessionToken, user });
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
});

export default router;
