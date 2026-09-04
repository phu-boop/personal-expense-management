import express from 'express';
import { authenticate } from '../middleware/auth';
import { getDashboardOverview } from '../controllers/dashboardController';

const router = express.Router();

router.use(authenticate);
router.get('/dashboard', getDashboardOverview);

export default router;
