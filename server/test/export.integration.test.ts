import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import ExportJob, { ExportFormat, ExportJobStatus } from '../src/models/ExportJob';
import LocalFilesystemStorage from '../src/services/storage/LocalFilesystemStorage';
import exportProcessorService from '../src/services/exportProcessorService';

jest.setTimeout(20000);

describe('export integration', () => {
  beforeAll(async () => {
    // connect to test mongodb via env or skip
    const uri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/pem_test';
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('creates a PDF export file', async () => {
    const job = await ExportJob.create({
      tenantId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      walletId: new mongoose.Types.ObjectId(),
      fromDate: new Date('2020-01-01'),
      toDate: new Date('2020-01-02'),
      format: ExportFormat.PDF,
      status: ExportJobStatus.PENDING,
    });

    const storage = new LocalFilesystemStorage(path.join(process.cwd(), 'test-exports'));
    await fs.promises.mkdir(storage.baseDir, { recursive: true });

    await exportProcessorService({ jobId: job._id, storage });

    const refreshed = await ExportJob.findById(job._id).lean();
    expect(refreshed).toBeTruthy();
    expect(refreshed?.status).toBe(ExportJobStatus.COMPLETED);
    expect(refreshed?.fileKey).toBeTruthy();
    expect(fs.existsSync(refreshed!.fileKey)).toBe(true);

    // cleanup
    try { fs.unlinkSync(refreshed!.fileKey as string); } catch {}
  });
});
