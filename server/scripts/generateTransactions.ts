import 'dotenv/config';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import config from '../src/config';

// Import models (require side-effect free model exports)
import Wallet from '../src/models/Wallet';
import Transaction from '../src/models/Transaction';

const walletIds = [
  '6a99505a4816e1a84c6b1f84',
  '6a9950614816e1a84c6b1f85',
  '6a9950694816e1a84c6b1f86',
  '6a9950784816e1a84c6b1f87',
];

const TOTAL = 250_000; // 1 million
const BATCH_SIZE = 1000; // insert many per batch

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount(): string {
  // generate amount between 0.50 and 1000.00 with 2 decimals
  const cents = randInt(50, 100000); // 0.50 to 1000.00
  return (cents / 100).toFixed(2);
}

async function main() {
  console.log('Connecting to MongoDB', config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI);

  try {
    // Preload wallets
    const wallets = await Wallet.find({ _id: { $in: walletIds.map(id => new mongoose.Types.ObjectId(id)) } }).lean();

    if (wallets.length === 0) {
      console.error('No wallets found for provided ids');
      process.exit(1);
    }

    // Map walletId -> wallet data
    const walletMap: Record<string, any> = {};
    for (const w of wallets) {
      walletMap[String(w._id)] = w;
    }

    // Distribute counts
    const per = Math.floor(TOTAL / walletIds.length);
    const remainder = TOTAL % walletIds.length;

    let totalInserted = 0;

    for (let i = 0; i < walletIds.length; i += 1) {
      const id = walletIds[i];
      const count = per + (i < remainder ? 1 : 0);
      const wallet = walletMap[id];
      if (!wallet) {
        console.warn('Skipping missing wallet', id);
        continue;
      }

      console.log(`Generating ${count} transactions for wallet ${id}`);

      // start from currentBalance stored in wallet
      let runningBalance = new Decimal(String(wallet.currentBalance?.toString() ?? wallet.initialBalance?.toString() ?? '0'));
      const tenantId = wallet.tenantId;
      const userId = wallet.userId;

      let insertedForWallet = 0;
      let batch: any[] = [];
      let netEffect = new Decimal(0);

      for (let j = 0; j < count; j += 1) {
        // pick type and amount
        let type = Math.random() < 0.5 ? 'INCOME' : 'EXPENSE';
        const amountStr = randomAmount();
        const amountDec = new Decimal(amountStr);

        // Prevent negative: if expense and would go negative, convert to income
        if (type === 'EXPENSE' && runningBalance.minus(amountDec).isNegative()) {
          type = 'INCOME';
        }

        const effect = type === 'INCOME' ? amountDec : amountDec.negated();

        // Generate date distributed over past 365 days
        const now = Date.now();
        const daysBack = Math.floor(Math.random() * 365);
        const date = new Date(now - daysBack * 24 * 60 * 60 * 1000);

        const doc = {
          tenantId: tenantId,
          userId: userId,
          walletId: new mongoose.Types.ObjectId(id),
          amount: mongoose.Types.Decimal128.fromString(amountDec.toFixed(2)),
          type,
          date,
          note: 'bulk-generated',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        batch.push(doc);
        runningBalance = runningBalance.plus(effect);
        netEffect = netEffect.plus(effect);

        if (batch.length >= BATCH_SIZE) {
          // insert batch
          // use native collection insertMany for performance
          await Transaction.collection.insertMany(batch, { ordered: false });
          insertedForWallet += batch.length;
          totalInserted += batch.length;
          process.stdout.write(`\rInserted ${totalInserted} / ${TOTAL}`);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await Transaction.collection.insertMany(batch, { ordered: false });
        insertedForWallet += batch.length;
        totalInserted += batch.length;
        process.stdout.write(`\rInserted ${totalInserted} / ${TOTAL}`);
        batch = [];
      }

      // Update wallet.currentBalance to reflect netEffect
      const newBalance = new Decimal(String(wallet.currentBalance?.toString() ?? wallet.initialBalance?.toString() ?? '0')).plus(netEffect);
      await Wallet.updateOne({ _id: wallet._id }, { $set: { currentBalance: mongoose.Types.Decimal128.fromString(newBalance.toFixed(2)), version: (wallet.version ?? 0) + 1 } });

      console.log(`\nDone wallet ${id}: inserted ${insertedForWallet}, netEffect ${netEffect.toFixed(2)}, newBalance ${newBalance.toFixed(2)}`);
    }

    console.log('\nAll done. Total inserted:', totalInserted);
  } catch (err) {
    console.error('Error during generation', err);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
