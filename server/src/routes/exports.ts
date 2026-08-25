import { Router } from 'express';

const router = Router();

router.post('/exports', (req, res) => {
  const { type = 'PDF' } = req.body || {};
  res.status(202).json({
    success: true,
    data: {
      jobId: `job-${Date.now()}`,
      type,
      status: 'queued',
    },
  });
});

router.get('/exports/:jobId', (_req, res) => {
  res.json({ success: true, data: { status: 'done', fileUrl: '/downloads/sample.xlsx' } });
});

router.get('/exports/:jobId/download', (_req, res) => {
  res.json({ success: true, data: { download: 'ready' } });
});

export default router;
