import express, { Request, Response } from 'express';
import { loginWithGoogle } from '../services/authService';

const router = express.Router();

router.post('/google', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Missing Google token' });
    }

    const result = await loginWithGoogle(token);
    return res.json(result);
  } catch (error: any) {
    console.error('Google Auth Error:', error);

    const message = error?.message === 'Missing Google token' || error?.message === 'Invalid token payload'
      ? error.message
      : 'Authentication failed';

    return res.status(401).json({ message });
  }
});

export default router;
