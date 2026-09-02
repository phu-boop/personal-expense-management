import express from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/transactionController';

const router = express.Router();

router.use(authenticate);

router.post('/:walletId/transactions', controller.createTransaction);
router.patch('/:walletId/transactions/:transactionId', controller.editTransaction);
router.get('/:walletId/transactions', controller.listTransactions);

export default router;
