import { Router } from 'express';

const router = Router();

router.get('/report/summary', (_req, res) => {
  res.json({ success: true, data: { message: 'Summary report endpoint ready' } });
});

export default router;
