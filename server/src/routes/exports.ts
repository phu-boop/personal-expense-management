import { Router } from 'express';
import fs from 'fs/promises';
import { ExportJobModel } from '../models/ExportJob.js';
import { exportService } from '../services/exportService.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/exports', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { walletId, fromDate, toDate, format = 'PDF' } = req.body || {};

    const job = await exportService.createJob(userId, {
      walletId,
      fromDate,
      toDate,
      format,
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId: String(job._id),
        status: 'PENDING',
        type: job.type,
      },
      message: 'Export job created successfully',
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error?.message || 'Failed to create export job',
    });
  }
});

router.get('/exports/:jobId', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const job = await ExportJobModel.findOne({ _id: req.params.jobId, userId }).lean();

    if (!job) {
      return res.status(404).json({ success: false, message: 'Export job not found' });
    }

    return res.json({
      success: true,
      data: {
        jobId: String(job._id),
        status: job.status,
        type: job.type,
        fileUrl: job.fileUrl || '',
      },
      message: 'Export job status loaded',
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error?.message || 'Failed to load export job status',
    });
  }
});

router.get('/exports/:jobId/download', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const job = await ExportJobModel.findOne({ _id: req.params.jobId, userId }).lean();

    if (!job) {
      return res.status(404).json({ success: false, message: 'Export job not found' });
    }

    if (job.status !== 'DONE' || !job.fileUrl) {
      return res.status(400).json({ success: false, message: 'Export file is not ready yet' });
    }

    await fs.access(job.fileUrl);
    const fileName = job.fileUrl.split('/').pop() || `export-${job._id}.xlsx`;

    return res.download(job.fileUrl, fileName);
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error?.message || 'Failed to download export file',
    });
  }
});

export default router;
