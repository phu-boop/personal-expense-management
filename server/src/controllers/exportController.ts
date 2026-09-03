import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ExportJob, { ExportFormat, ExportJobStatus } from '../models/ExportJob';
import { createRedisQueueFromEnvironment, buildQueueKey } from '../services/redisQueue';
import config from '../config';

export async function createExport(req: any, res: Response) {
  // Accept both `{ fromDate,toDate }` and legacy `{ startDate,endDate }` from client
  const { walletId } = req.body ?? {};
  const fromDateRaw = req.body?.fromDate ?? req.body?.startDate;
  const toDateRaw = req.body?.toDate ?? req.body?.endDate;
  const formatRaw = req.body?.format;

  // Debug: log incoming payload to help diagnose client/server mismatches
  console.debug('createExport payload', { body: req.body, walletId, fromDateRaw, toDateRaw, formatRaw });

  if (!walletId || !fromDateRaw || !toDateRaw || !formatRaw) return res.status(400).json({ message: 'walletId, fromDate, toDate, format required' });

  const format = String(formatRaw).toUpperCase();
  if (!Object.values(ExportFormat).includes(format as ExportFormat)) return res.status(400).json({ message: 'invalid format' });

  // tenant/user from auth middleware
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  if (!tenantId || !userId) return res.status(401).json({ message: 'auth required' });

  const job = await ExportJob.create({ tenantId, userId, walletId: new mongoose.Types.ObjectId(String(walletId)), fromDate: new Date(fromDateRaw), toDate: new Date(toDateRaw), format: format as ExportFormat, status: ExportJobStatus.PENDING });

  // enqueue
  const queue = await createRedisQueueFromEnvironment();
  await queue.enqueue('export-jobs', { jobId: job._id.toHexString(), tenantId: tenantId.toHexString() });

  return res.status(202).json({ jobId: job._id.toHexString() });
}

export async function getExport(req: any, res: Response) {
  try {
    const jobId = req.params.jobId;
    if (!jobId || !mongoose.isValidObjectId(jobId)) return res.status(400).json({ message: 'invalid jobId' });

    const job = await ExportJob.findById(jobId).lean();
    if (!job) return res.status(404).json({ message: 'job not found' });

    // ensure tenant/user own the job
    const tenantId = req.user?.tenantId?.toString();
    const userId = req.user?.id?.toString();
    if (String(job.tenantId) !== String(tenantId) || String(job.userId) !== String(userId)) return res.status(403).json({ message: 'forbidden' });

    return res.json({ job });
  } catch (err: any) {
    console.error('Get export job error', err);
    return res.status(500).json({ message: err?.message || 'failed' });
  }
}

export async function downloadExport(req: any, res: Response) {
  try {
    const jobId = req.params.jobId;
    if (!jobId || !mongoose.isValidObjectId(jobId)) return res.status(400).json({ message: 'invalid jobId' });

    const job = await ExportJob.findById(jobId).lean();
    if (!job) return res.status(404).json({ message: 'job not found' });

    const tenantId = req.user?.tenantId?.toString();
    const userId = req.user?.id?.toString();
    if (String(job.tenantId) !== String(tenantId) || String(job.userId) !== String(userId)) return res.status(403).json({ message: 'forbidden' });

    if (job.status !== ExportJobStatus.COMPLETED || !job.fileKey) return res.status(404).json({ message: 'file not available' });

    const filePath = job.fileKey;
    return res.download(filePath);
  } catch (err: any) {
    console.error('Download export error', err);
    return res.status(500).json({ message: err?.message || 'failed' });
  }
}
