import { Request, Response } from 'express';
import mongoose from 'mongoose';

import * as validator from '../validators/walletValidator';
import * as service from '../services/walletService';
import { AuthRequest } from '../middleware/auth';

export async function createWallet(req: AuthRequest, res: Response) {
  try {
    const payload = validator.validateCreateBody(req.body ?? {}, req.user!.tenantId, req.user!.id);
    const created = await service.createWalletForUser({
      tenantId: payload.tenantId,
      userId: payload.userId,
      name: payload.name,
      accountNumber: payload.accountNumber,
      initialBalance: payload.initialBalanceDecimal.toFixed(2),
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    console.error('Create wallet error:', err);
    return res.status(400).json({ success: false, message: err?.message || 'Failed to create wallet' });
  }
}

export async function listWallets(req: AuthRequest, res: Response) {
  try {
    const limit = validator.parseLimit(req.query.limit);
    const cursor = validator.decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);

    const result = await service.listWalletsForUser({ tenantId: req.user!.tenantId, userId: req.user!.id, limit, cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('List wallets error:', err);
    return res.status(400).json({ success: false, message: err?.message || 'Failed to list wallets' });
  }
}

export async function listWalletsCompact(req: AuthRequest, res: Response) {
  try {
    const limit = validator.parseLimit(req.query.limit);
    const cursor = validator.decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);

    const result = await service.listWalletsForUser({ tenantId: req.user!.tenantId, userId: req.user!.id, limit, cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined });

    // compact shape: items directly in response
    return res.json({ success: true, items: result.items, hasMore: result.hasMore, nextCursor: result.nextCursor, limit: result.limit });
  } catch (err: any) {
    console.error('Compact list wallets error:', err);
    return res.status(400).json({ success: false, message: err?.message || 'Failed to list wallets (compact)' });
  }
}

export async function getWallet(req: AuthRequest, res: Response) {
  try {
    const walletId = req.params.walletId;
    if (!mongoose.isValidObjectId(walletId)) return res.status(400).json({ success: false, message: 'Invalid walletId' });

    const wallet = await service.getWalletByIdForUser({ tenantId: req.user!.tenantId, userId: req.user!.id, walletId });
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });

    return res.json({ success: true, data: wallet });
  } catch (err: any) {
    console.error('Get wallet detail error:', err);
    return res.status(400).json({ success: false, message: err?.message || 'Failed to get wallet detail' });
  }
}
