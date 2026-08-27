import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { walletService } from '../services/walletService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { data, source } = await walletService.listWalletsForUser(userId);
    return res.json({ success: true, data, source });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load wallets' });
  }
});

router.get('/:walletId', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const wallet = await walletService.getWalletDetail(userId, req.params.walletId);
    return res.json({ success: true, data: wallet });
  } catch (error: any) {
    const statusCode = error?.message === 'Wallet not found' ? 404 : 400;
    return res.status(statusCode).json({ success: false, message: error?.message || 'Failed to load wallet detail' });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const wallet = await walletService.createWalletForUser(userId, req.body || {});
    return res.status(201).json({ success: true, data: wallet });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to create wallet' });
  }
});

export default router;
