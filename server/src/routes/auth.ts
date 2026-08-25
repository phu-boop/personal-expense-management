import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { authService } from '../services/authService.js';

const router = Router();

router.post('/google', async (req, res) => {
  try {
    const result = await authService.loginWithGoogle(req.body || {});
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error?.message || 'Failed to authenticate user',
    });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const user = await authService.getCurrentUser(userId);
    return res.json({ success: true, user });
  } catch (error: any) {
    const statusCode = error?.message === 'User not found' ? 404 : 400;
    return res.status(statusCode).json({
      success: false,
      message: error?.message || 'Failed to load current user',
    });
  }
});

export default router;
