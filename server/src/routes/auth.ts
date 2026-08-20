import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

const router = express.Router();

// Mock Google Login for development
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { googleId, email, name, avatar } = req.body;

    if (!googleId || !email || !name) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    let user = await User.findOne({ googleId });

    if (!user) {
      user = new User({ googleId, email, name, avatar });
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
