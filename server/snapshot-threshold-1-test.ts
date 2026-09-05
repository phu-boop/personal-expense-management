import mongoose from 'mongoose';
import config from './src/config';
import Wallet from './src/models/Wallet';
import Transaction from './src/models/Transaction';
import { toDecimal128 } from './src/utils/money';
import { createSnapshotIfNeeded } from './src/workers/snapshotWorker';

async function main() {
  await mongoose.connect(config.MONGO_URI);

  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const wallet = await Wallet.create({
    tenantId,
    userId,
    name: 'Snapshot Threshold 1 Test',
    initialBalance: toDecimal128('1000'),
    initialBalanceDate: new Date('2025-01-01T00:00:00.000Z'),
    currentBalance: toDecimal128('1000'),
    version: 0,
  });

  const now = new Date('2026-09-05T00:00:00.000Z');
  const docs: any[] = [];
  for (let i = 0; i < 3; i++) {
    const date = new Date(now.getTime() + i * 60 * 1000);
    docs.push({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128(String(200 + i)),
      type: i % 2 === 0 ? 'INCOME' : 'EXPENSE',
      date,
      createdAt: date,
      updatedAt: date,
      note: `threshold-1-${i}`,
    });
  }

  await Transaction.insertMany(docs, { ordered: false });
  const res = await createSnapshotIfNeeded(wallet._id, { tenantId });

  console.log(JSON.stringify({
    walletId: wallet._id.toString(),
    transactionsInserted: docs.length,
    result: res,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
