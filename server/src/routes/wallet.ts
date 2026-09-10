import express from 'express';

import { authenticate } from '../middleware/auth';
import { createWallet, listWallets, listWalletsCompact, getWallet } from '../controllers/walletController';

const router = express.Router();

router.use(authenticate);

router.post('/', createWallet as any);

router.get('/', listWallets as any);

router.get('/compact', listWalletsCompact as any);

router.get('/:walletId', getWallet as any);

export default router;
