import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config';
import Wallet from '../src/models/Wallet';
import { createRedisQueueFromEnvironment } from '../src/services/redisQueue';

async function main() {
  console.log('Connecting to MongoDB', config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI);

  try {
    const wallets = await Wallet.find().lean();
    if (!wallets || wallets.length === 0) {
      console.log('No wallets found');
      return;
    }

    const queue = await createRedisQueueFromEnvironment();
    console.log('Connected to Redis, enqueuing snapshot-check jobs for', wallets.length, 'wallets');

    for (const w of wallets) {
      const payload = { walletId: w._id, tenantId: w.tenantId };
      await queue.enqueue('snapshot-check', payload);
      console.log('Enqueued snapshot-check for', String(w._id));
    }

    const peeked = await queue.peek('snapshot-check');
    console.log('Snapshot queue length (peek sample):', Array.isArray(peeked) ? peeked.length : 0);
  } catch (err) {
    console.error('Failed to enqueue snapshot jobs', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
