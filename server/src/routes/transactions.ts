import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { transactionService } from '../services/transactionService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { walletId, category, limit = '20', before } = req.query as Record<string, string>;
    const result = await transactionService.listTransactions(userId, { walletId, category, limit: Number(limit), before });
    return res.json({
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      message: 'Transactions loaded successfully',
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load transactions' });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const data = await transactionService.getInsights(userId);
    return res.json({ success: true, data, message: 'Insights loaded successfully' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load insights' });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const transaction = await transactionService.createTransaction(userId, req.body || {});
    return res.status(201).json({ success: true, data: transaction });
  } catch (error: any) {
    const statusCode = error?.message === 'Wallet not found' ? 404 : 400;
    return res.status(statusCode).json({ success: false, message: error?.message || 'Failed to create transaction' });
  }
});

router.get('/audit', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const logs = await transactionService.getTransactionAuditLogs(userId);
    return res.json({ success: true, data: logs });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load transaction audit logs' });
  }
});

router.get('/:id/audit', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const logs = await transactionService.getTransactionAuditLogs(userId, id);
    return res.json({ success: true, data: logs });
  } catch (error: any) {
    const statusCode = error?.message === 'Transaction not found' ? 404 : 400;
    return res.status(statusCode).json({ success: false, message: error?.message || 'Failed to load transaction audit logs' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, message: 'No update data provided' });
    }

    const updated = await transactionService.updateTransaction(userId, id, req.body || {});
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    const statusCode = error?.message === 'Transaction not found' || error?.message === 'Wallet not found' ? 404 : 400;
    return res.status(statusCode).json({ success: false, message: error?.message || 'Invalid transaction update' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    await transactionService.deleteTransaction(userId, id);
    return res.status(204).send();
  } catch (error: any) {
    const statusCode = error?.message === 'Transaction not found' ? 404 : 400;
    return res.status(statusCode).json({ success: false, message: error?.message || 'Failed to delete transaction' });
  }
});

router.get('/statement', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { walletId, from, to } = req.query as Record<string, string>;
    const data = await transactionService.getStatement(userId, { walletId, from, to });
    return res.json({
      success: true,
      data: {
        summary: {
          openingBalance: data.openingBalance,
          totalIncome: data.totalIncome,
          totalExpense: data.totalExpense,
          closingBalance: data.closingBalance,
        },
        transactions: data.transactions,
        wallets: await (await import('../repositories/walletRepository.js')).walletRepository.listByUser(userId),
      },
      message: 'Statement loaded successfully',
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load statement' });
  }
});

export default router;
