import express from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/exportController';

const router = express.Router();
router.use(authenticate);

router.post('/', controller.createExport);
router.get('/:jobId', controller.getExport);
router.get('/:jobId/download', controller.downloadExport);

export default router;
