import 'dotenv/config';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import config from '../src/config';

// Import models (require side-effect free model exports)
import Wallet from '../src/models/Wallet';
import Transaction from '../src/models/Transaction';
import { CATEGORY_CATALOG } from '../src/constants/categoryCatalog';

const TOTAL = 250000; // target transactions to generate
const BATCH_SIZE = 5000; // insert many per batch (tune for memory/perf)

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount(): string {
  // generate integer amount (no fractional VND)
  const amount = randInt(50, 100000);
  return String(amount);
}

function randomCategory(type: 'INCOME' | 'EXPENSE') {
  const items = CATEGORY_CATALOG.filter((category) => category.type === type);
  return items[randInt(0, items.length - 1)]._id;
}

const walletIds = [
  '6a9bb29ae44c09af8b6bec5f',
  '6a9bb2d0e44c09af8b6bec60',
  '6a9bb2d9e44c09af8b6bec61',
  '6a9bb2e2e44c09af8b6bec62',
];

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

        // Generate a timestamp within the target day (2026-09-02) with random time
        const targetDayStart = new Date('2026-09-02T00:00:00.000Z').getTime();
        const msIntoDay = Math.floor(Math.random() * 24 * 60 * 60 * 1000);
        const date = new Date(targetDayStart + msIntoDay);

        const doc = {
          tenantId: tenantId,
          userId: userId,
          walletId: new mongoose.Types.ObjectId(id),
          category: randomCategory(type),
          amount: mongoose.Types.Decimal128.fromString(amountDec.toFixed(0)),
          type,
          date,
          note: 'bulk-generated',
          createdAt: date,
          updatedAt: date,
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
      await Wallet.updateOne({ _id: wallet._id }, { $set: { currentBalance: mongoose.Types.Decimal128.fromString(newBalance.toFixed(0)), version: (wallet.version ?? 0) + 1 } });

      console.log(`\nDone wallet ${id}: inserted ${insertedForWallet}, netEffect ${netEffect.toFixed(0)}, newBalance ${newBalance.toFixed(0)}`);
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
