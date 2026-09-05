import mongoose from 'mongoose';
import config from '../src/config';
import Wallet from '../src/models/Wallet';
import Transaction from '../src/models/Transaction';
import { toDecimal128 } from '../src/utils/money';
import { createRedisQueueFromEnvironment } from '../src/services/redisQueue';

async function main() {
  await mongoose.connect(config.MONGO_URI);

  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const wallet = await Wallet.create({
    tenantId,
    userId,
    name: 'Snapshot Test Wallet 51k',
    initialBalance: toDecimal128('1000'),
    initialBalanceDate: new Date('2025-01-01T00:00:00.000Z'),
    currentBalance: toDecimal128('1000'),
    version: 0,
  });

  const docs: any[] = [];
  for (let i = 0; i < 51000; i++) {
    const date = new Date('2026-09-05T00:00:00.000Z');
    date.setMinutes(i);
    docs.push({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128(String(100 + (i % 7))),
      type: i % 2 === 0 ? 'INCOME' : 'EXPENSE',
      date,
      createdAt: date,
      updatedAt: date,
      note: `snapshot-test-${i}`,
    });
  }

  await Transaction.insertMany(docs, { ordered: false });

  const queue = await createRedisQueueFromEnvironment();
  await queue.enqueue('snapshot-check', { walletId: wallet._id, tenantId });

  console.log('walletId', wallet._id.toString());
  console.log('transactionsInserted', docs.length);
  console.log('jobQueued', 'snapshot-check');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
