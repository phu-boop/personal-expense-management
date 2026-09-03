import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import ExportJob, { ExportFormat, ExportJobStatus } from '../src/models/ExportJob';
import LocalFilesystemStorage from '../src/services/storage/LocalFilesystemStorage';
import exportProcessorService from '../src/services/exportProcessorService';

async function run() {
  const uri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/pem_test';
  await mongoose.connect(uri);
  try {
    // ensure a wallet exists for export - reuse wallet tenant/user when present
    const walletIdStr = process.env.TEST_WALLET_ID || '6a96a6c047053af5af4bd2dd';
    const walletId = new mongoose.Types.ObjectId(walletIdStr);
    const Wallet = require('../src/models/Wallet').default;
    let tenantId = new mongoose.Types.ObjectId();
    let userId = new mongoose.Types.ObjectId();

    const existing = await Wallet.findById(walletId).lean();
    console.log('DIAG: existing before create?', !!existing);
    if (existing) {
      // reuse existing wallet's tenant/user
      tenantId = existing.tenantId;
      userId = existing.userId;
      console.log('DIAG: reusing wallet tenant/user', { tenantId: String(tenantId), userId: String(userId) });
    } else {
      try {
        const created = await Wallet.create({
          _id: walletId,
          tenantId,
          userId,
          name: 'Test Wallet',
          initialBalance: mongoose.Types.Decimal128.fromString('1000.00'),
          initialBalanceDate: new Date(),
          currentBalance: mongoose.Types.Decimal128.fromString('1000.00'),
          version: 0,
        });
        tenantId = created.tenantId;
        userId = created.userId;
        console.log('DIAG: wallet created', { id: String(created._id), tenantId: String(tenantId), userId: String(userId) });
      } catch (e) {
        console.error('DIAG: wallet create error', e);
      }
    }

    const fromEnv = process.env.FROM_DATE || '2026-07-31';
    const toEnv = process.env.TO_DATE || '2026-09-03';
    const fmt = (process.env.EXPORT_FORMAT || 'PDF').toUpperCase();
    const job = await ExportJob.create({
      tenantId,
      userId,
      walletId,
      fromDate: new Date(fromEnv),
      toDate: new Date(toEnv),
      format: fmt === 'XLSX' ? ExportFormat.XLSX : ExportFormat.PDF,
      status: ExportJobStatus.PENDING,
    });

    // Diagnostic: confirm wallet exists with same tenant/user and show DB
    const found = await Wallet.findOne({ _id: walletId, tenantId, userId }).lean();
    console.log('DIAG: wallet existing?', !!found, { walletId: String(walletId), tenantId: String(tenantId), userId: String(userId), db: mongoose.connection.db.databaseName });

    const storage = new LocalFilesystemStorage(path.join(process.cwd(), 'test-exports'));
    await fs.promises.mkdir(storage.baseDir, { recursive: true });

    console.log('Running exportProcessorService for job', String(job._id));
    await exportProcessorService({ jobId: job._id, storage });

    const refreshed = await ExportJob.findById(job._id).lean();
    console.log('Job status:', refreshed?.status);
    console.log('FileKey:', refreshed?.fileKey);

    if (refreshed?.fileKey && fs.existsSync(String(refreshed.fileKey))) {
      console.log('Export file exists at', refreshed.fileKey);
      try { fs.unlinkSync(String(refreshed.fileKey)); } catch {}
    } else {
      console.error('Export file missing');
      process.exitCode = 2;
    }

    // cleanup job
    await ExportJob.deleteOne({ _id: job._id });
  } catch (err) {
    console.error('Export runner error', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
