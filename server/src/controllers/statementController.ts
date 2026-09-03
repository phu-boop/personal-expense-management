import { Request, Response } from 'express';
import mongoose from 'mongoose';
import StatementService from '../services/statementService';
import { parseDate } from '../validators/transactionValidator';

export const getStatement = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId as mongoose.Types.ObjectId;
    const userId = (req as any).user?._id as mongoose.Types.ObjectId;
    const walletId = new mongoose.Types.ObjectId(req.params.walletId);

    const from = parseDate(req.query.from as string);
    const to = parseDate(req.query.to as string);

    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const cursor = req.query.cursor ? (() => {
      try {
        const decoded = Buffer.from(String(req.query.cursor), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded) as { date: string; createdAt: string; _id: string };
        return { date: new Date(parsed.date), createdAt: new Date(parsed.createdAt), _id: new mongoose.Types.ObjectId(parsed._id) };
      } catch {
        return undefined;
      }
    })() : undefined;

    const result = await StatementService.computeStatement({ tenantId, userId, walletId, from, to, limit, cursor });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
};
