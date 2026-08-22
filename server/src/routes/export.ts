import express, { Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { AuthRequest, authenticate, requireReadAccess, requireWriteAccess } from '../middleware/auth';
import ExportJob, { ExportJobStatus } from '../models/ExportJob';
import { normalizeExportFormat } from '../services/exportJobService';
import { buildExportPathForJob } from '../services/exportProcessorService';
import { buildQueueKey, createRedisQueueClient, normalizeQueuePayload } from '../services/redisQueue';

const router = express.Router();
router.use(authenticate);
router.use(requireReadAccess);

const EXPORT_DIR = path.resolve(process.cwd(), 'exports');

const ensureExportDirectory = async () => {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
};

const buildExportFilePath = (jobId: string, format: 'xlsx' | 'pdf') => path.join(EXPORT_DIR, `${jobId}.${format}`);

const createJobFileName = (job: { _id: mongoose.Types.ObjectId; filters: { startDate: string; endDate: string }; format: 'xlsx' | 'pdf' }) =>
  `statement_${job.filters.startDate}_to_${job.filters.endDate}.${job.format}`;

const exportQueue = createRedisQueueClient();

const queueExportJob = async (jobId: string) => {
  const queueKey = buildQueueKey('export-jobs');
  const payload = normalizeQueuePayload({ jobId, retries: 0 });

  try {
    await exportQueue.enqueue('export-jobs', payload);
    return { queueKey, payload };
  } catch (error) {
    console.warn('Queue enqueue failed', error);
    return null;
  }
};

// export generation is handled by the worker via services/exportProcessorService

router.post('/', requireWriteAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, startDate, endDate, format } = req.body ?? {};

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    if (walletId && !mongoose.isValidObjectId(walletId)) {
      return res.status(400).json({ message: 'walletId must be a valid ObjectId' });
    }

    const normalizedFormat = normalizeExportFormat(format);
    const job = await ExportJob.create({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      format: normalizedFormat,
      filters: {
        walletId: walletId ? new mongoose.Types.ObjectId(walletId) : undefined,
        startDate,
        endDate,
      },
      status: ExportJobStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });

    const queued = await queueExportJob(String(job._id));
    if (!queued) {
      await ExportJob.findByIdAndUpdate(job._id, {
        status: ExportJobStatus.FAILED,
        error: 'Failed to enqueue export job',
      });
      return res.status(500).json({ message: 'Failed to enqueue export job' });
    }

    res.status(202).json({
      jobId: String(job._id),
      status: ExportJobStatus.PENDING,
      format: job.format,
      expiresAt: job.expiresAt,
    });
  } catch (error) {
    console.error('Failed to create export job:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const job = await ExportJob.findOne({ _id: req.params.id, tenantId: req.user!.tenantId, userId: req.user!.id }).lean();

    if (!job) {
      return res.status(404).json({ message: 'Export job not found' });
    }

    if (new Date(job.expiresAt).getTime() < Date.now() && job.status !== ExportJobStatus.COMPLETED) {
      await ExportJob.findByIdAndUpdate(job._id, { status: ExportJobStatus.EXPIRED });
      return res.status(410).json({ message: 'Export job expired', status: ExportJobStatus.EXPIRED });
    }

    res.json(job);
  } catch (error) {
    console.error('Failed to read export job:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const job = await ExportJob.findOne({ _id: req.params.id, tenantId: req.user!.tenantId, userId: req.user!.id }).lean();

    if (!job) {
      return res.status(404).json({ message: 'Export job not found' });
    }

    if (job.status !== ExportJobStatus.COMPLETED) {
      return res.status(409).json({ message: 'Export is not ready yet', status: job.status });
    }

    const filePath = buildExportPathForJob(String(job._id), job.format);

    try {
      const fileBuffer = await fs.readFile(filePath);

      const contentType = job.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${createJobFileName(job as any)}"`);
      res.send(fileBuffer);
    } catch (err) {
      // file missing on disk despite DB saying COMPLETED
      console.warn('Export file missing for job', String(job._id));
      await ExportJob.findByIdAndUpdate(job._id, { status: ExportJobStatus.FAILED, error: 'Export file missing' });
      return res.status(410).json({ message: 'Export file not found', status: ExportJobStatus.FAILED });
    }
  } catch (error) {
    console.error('Failed to download export:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
