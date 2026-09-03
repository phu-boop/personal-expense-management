import express from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/statementController';

const router = express.Router();

router.use(authenticate);

router.get('/:walletId/statement', controller.getStatement);

export default router;
