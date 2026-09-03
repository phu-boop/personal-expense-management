import { createRedisQueueFromEnvironment } from '../services/redisQueue';
import config from '../config';
import { ExportJob } from '../models/ExportJob';
import LocalFilesystemStorage from '../services/storage/LocalFilesystemStorage';
import exportProcessorService from '../services/exportProcessorService';

async function run() {
  const queue = await createRedisQueueFromEnvironment();
  const storage = new LocalFilesystemStorage();

  while (true) {
    try {
      const claimed = await queue.claim('export-jobs');
      if (!claimed) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const { parsed, raw } = claimed as any;
      const jobId = parsed.jobId;
      if (!jobId) {
        await queue.ack('export-jobs', raw);
        continue;
      }

      try {
        await exportProcessorService({ jobId: new (require('mongoose')).Types.ObjectId(jobId), storage });
        await queue.ack('export-jobs', raw);
      } catch (err) {
        console.error('export job failed', err);
        await queue.enqueueDeadLetter('export-jobs', { ...parsed, error: String(err) });
        await queue.ack('export-jobs', raw);
      }
    } catch (err) {
      console.error('export consumer loop error', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

export default run;
