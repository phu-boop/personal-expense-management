import express from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/transactionController';

const allTransactionsRouter = express.Router();
const walletTransactionsRouter = express.Router();

allTransactionsRouter.use(authenticate);
allTransactionsRouter.get('/transactions', controller.listTransactionsAcrossWallets);

walletTransactionsRouter.use(authenticate);
walletTransactionsRouter.post('/:walletId/transactions', controller.createTransaction);
walletTransactionsRouter.patch('/:walletId/transactions/:transactionId', controller.editTransaction);
walletTransactionsRouter.get('/:walletId/transactions', controller.listTransactions);

export { allTransactionsRouter, walletTransactionsRouter };
export default walletTransactionsRouter;
