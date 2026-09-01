import express, { Request, Response } from 'express';
import mongoose from 'mongoose';

import Wallet from '../models/Wallet';
import { authenticate, AuthRequest } from '../middleware/auth';
import { toDecimal, toDecimal128 } from '../utils/money';

const router = express.Router();

const withWalletResponse = (wallet: any) => ({
  _id: wallet._id,
  tenantId: wallet.tenantId,
  userId: wallet.userId,
  name: wallet.name,
  accountNumber: wallet.accountNumber,
  initialBalance: wallet.initialBalance,
  currentBalance: wallet.currentBalance,
  version: wallet.version,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

const parseLimit = (value: unknown): number => {
  const parsed = Number(value ?? 20);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('limit must be a positive integer');
  }

  return Math.min(parsed, 100);
};

const decodeCursor = (cursor?: string) => {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);

    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    return {
      createdAt: new Date(parsed.createdAt),
      _id: new mongoose.Types.ObjectId(parsed._id),
    };
  } catch {
    return undefined;
  }
};

const encodeCursor = (wallet: any) => {
  const cursor = {
    createdAt: wallet.createdAt.toISOString(),
    _id: wallet._id.toString(),
  };

  return Buffer.from(JSON.stringify(cursor)).toString('base64');
};

router.use(authenticate);

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, accountNumber, initialBalance } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Wallet name is required' });
    }

    if (accountNumber !== undefined && (typeof accountNumber !== 'string' || !accountNumber.trim())) {
      return res.status(400).json({ success: false, message: 'accountNumber must be a non-empty string when provided' });
    }

    if (initialBalance === undefined || initialBalance === null || initialBalance === '') {
      return res.status(400).json({ success: false, message: 'initialBalance is required' });
    }

    const initialBalanceDecimal = toDecimal(String(initialBalance));

    if (!initialBalanceDecimal.isFinite() || initialBalanceDecimal.isNaN()) {
      return res.status(400).json({ success: false, message: 'initialBalance must be a valid decimal value' });
    }

    if (initialBalanceDecimal.isNegative()) {
      return res.status(400).json({ success: false, message: 'initialBalance cannot be negative' });
    }

    const wallet = await Wallet.create({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      name: name.trim(),
      accountNumber: accountNumber?.trim() || undefined,
      initialBalance: toDecimal128(initialBalanceDecimal),
      initialBalanceDate: new Date(),
      currentBalance: toDecimal128(initialBalanceDecimal),
      version: 0,
    });

    return res.status(201).json({
      success: true,
      data: withWalletResponse(wallet.toObject()),
    });
  } catch (error: any) {
    console.error('Create wallet error:', error);
    return res.status(400).json({ success: false, message: error?.message || 'Failed to create wallet' });
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);

    const query: any = {
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
    };

    if (cursor) {
      query.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        {
          createdAt: cursor.createdAt,
          _id: { $lt: cursor._id },
        },
      ];
    }

    const items = await Wallet.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1]) : null;

    return res.json({
      success: true,
      data: {
        items: sliced.map(withWalletResponse),
        hasMore,
        nextCursor,
        limit,
      },
    });
  } catch (error: any) {
    console.error('List wallets error:', error);
    return res.status(400).json({ success: false, message: error?.message || 'Failed to list wallets' });
  }
});

// Compact wallet list: returns a slimmer payload for frontend consumption
router.get('/compact', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);

    const query: any = {
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
    };

    if (cursor) {
      query.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        {
          createdAt: cursor.createdAt,
          _id: { $lt: cursor._id },
        },
      ];
    }

    const items = await Wallet.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1]) : null;

    // return a compact shape (no nested `data` wrapper)
    return res.json({
      success: true,
      items: sliced.map(withWalletResponse),
      hasMore,
      nextCursor,
      limit,
    });
  } catch (error: any) {
    console.error('Compact list wallets error:', error);
    return res.status(400).json({ success: false, message: error?.message || 'Failed to list wallets (compact)' });
  }
});

router.get('/:walletId', async (req: AuthRequest, res: Response) => {
  try {
    const walletId = req.params.walletId;

    if (!mongoose.isValidObjectId(walletId)) {
      return res.status(400).json({ success: false, message: 'Invalid walletId' });
    }

    const wallet = await Wallet.findOne({
      _id: walletId,
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
    }).lean();

    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    return res.json({
      success: true,
      data: withWalletResponse(wallet),
    });
  } catch (error: any) {
    console.error('Get wallet detail error:', error);
    return res.status(400).json({ success: false, message: error?.message || 'Failed to get wallet detail' });
  }
});

export default router;
