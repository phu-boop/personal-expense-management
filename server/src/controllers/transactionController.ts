import { Response } from 'express';
import mongoose from 'mongoose';
import * as validator from '../validators/transactionValidator';
import * as txService from '../services/transactionService';
import { AuthRequest } from '../middleware/auth';

export const createTransaction = async (req: AuthRequest, res: Response) => {
  const walletId = req.params.walletId;
  const date = validator.parseDate(req.body.date);
  const amount = validator.parseAmount(req.body.amount);
  const type = validator.validateTransactionType(req.body.type);
  const category = validator.normalizeCategory(req.body.category);

  try {
    const tx = await txService.createTransactionWithInvalidation({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      walletId: new mongoose.Types.ObjectId(walletId),
      amount,
      type,
      date,
      category,
      note: typeof req.body.note === 'string' ? req.body.note.trim() || undefined : undefined,
    });

    res.status(201).json({ transaction: tx.toObject() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const editTransaction = async (req: AuthRequest, res: Response) => {
  const walletId = req.params.walletId;
  const txId = validator.normalizeTransactionId(req.params.transactionId);
  const date = req.body.date ? validator.parseDate(req.body.date) : undefined;
  const amount = req.body.amount ? validator.parseAmount(req.body.amount) : undefined;
  const category = req.body.category ? validator.normalizeCategory(req.body.category) : undefined;

  try {
    const tx = await txService.editTransaction({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      walletId: new mongoose.Types.ObjectId(walletId),
      transactionId: txId,
      amount,
      type: req.body.type,
      date,
      note: req.body.note,
    });

    res.json({ transaction: tx.toObject() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const listTransactions = async (req: AuthRequest, res: Response) => {
  const walletId = new mongoose.Types.ObjectId(req.params.walletId);
  const limit = validator.parseLimit(req.query.limit);
  const cursor = validator.decodeCursor(req.query.cursor as string | undefined);
  const from = req.query.from ? validator.parseDate(req.query.from) : undefined;
  const to = req.query.to ? validator.parseDate(req.query.to) : undefined;

  try {
    const result = await txService.listTransactions({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      walletId,
      limit,
      cursor,
      from,
      to,
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const listTransactionsAcrossWallets = async (req: AuthRequest, res: Response) => {
  const limit = validator.parseLimit(req.query.limit);
  const cursor = validator.decodeCursor(req.query.cursor as string | undefined);
  const from = req.query.from ? validator.parseDate(req.query.from) : undefined;
  const to = req.query.to ? validator.parseDate(req.query.to) : undefined;
  const walletId = typeof req.query.walletId === 'string' && mongoose.isValidObjectId(req.query.walletId)
    ? new mongoose.Types.ObjectId(req.query.walletId)
    : undefined;

  try {
    const result = walletId
      ? await txService.listTransactions({
          tenantId: req.user!.tenantId!,
          userId: req.user!.id,
          walletId,
          limit,
          cursor,
          from,
          to,
        })
      : await txService.listTransactionsAcrossWallets({
          tenantId: req.user!.tenantId!,
          userId: req.user!.id,
          limit,
          cursor,
          from,
          to,
        });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};
