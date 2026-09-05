import mongoose from 'mongoose';
import config from './src/config';
import Wallet from './src/models/Wallet';
import Transaction from './src/models/Transaction';
import BalanceSnapshot from './src/models/BalanceSnapshot';
import { toDecimal128 } from './src/utils/money';
import { createSnapshotIfNeeded } from './src/workers/snapshotWorker';

async function main() {
  await mongoose.connect(config.MONGO_URI);
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const wallet = await Wallet.create({
    tenantId,
    userId,
    name: 'Sequence replay wallet',
    initialBalance: toDecimal128('0'),
    initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
    currentBalance: toDecimal128('0'),
    version: 0,
  });

  for (let i = 1; i <= 2; i++) {
    const d = new Date('2026-09-05T00:00:00.000Z');
    d.setMinutes(i);
    await Transaction.create({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128('10'),
      type: 'INCOME',
      date: d,
      note: `tx-${i}`,
    });
    const res = await createSnapshotIfNeeded(wallet._id, { tenantId, snapshotInterval: 1 });
    console.log('after insert tx', i, JSON.stringify(res));
  }

  const snaps = await BalanceSnapshot.find({ walletId: wallet._id, tenantId }).sort({ lastTransactionDate: 1, lastTransactionCreatedAt: 1, lastTransactionId: 1 }).lean();
  console.log('snapshots count', snaps.length);
  console.log('snapshot list', snaps.map((s) => ({ id: String(s._id), lastTxId: String(s.lastTransactionId), status: s.status })));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
