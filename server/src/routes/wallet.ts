import express, { Response } from 'express';
import { AuthRequest, authenticate, requireReadAccess, requireWriteAccess } from '../middleware/auth';
import Wallet from '../models/Wallet';
import { buildWalletListFilter, normalizeWalletListQuery } from '../services/walletListQuery';

const router = express.Router();
router.use(authenticate);
router.use(requireReadAccess);

router.post('/', requireWriteAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { name, accountNumber, initialBalance, startDate, colorTheme } = req.body;

    if (!name || initialBalance === undefined || !startDate) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const wallet = new Wallet({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      name,
      accountNumber,
      initialBalance,
      currentBalance: initialBalance,
      colorTheme: colorTheme || 'emerald',
      startDate: new Date(startDate),
    });

    await wallet.save();
    res.status(201).json(wallet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const hasPaginationOrSearch = 'page' in req.query || 'limit' in req.query || 'search' in req.query;

    if (!hasPaginationOrSearch) {
      const wallets = await Wallet.find({ tenantId: req.user!.tenantId, userId: req.user!.id }).sort({ createdAt: -1 });
      return res.json(wallets);
    }

    const { page, limit, search } = normalizeWalletListQuery(req.query);
    const filter = buildWalletListFilter(req.user!.tenantId!, req.user!.id, search);

    const [wallets, total] = await Promise.all([
      Wallet.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Wallet.countDocuments(filter),
    ]);

    return res.json({
      data: wallets,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
