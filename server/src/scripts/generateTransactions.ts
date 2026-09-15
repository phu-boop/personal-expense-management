import 'dotenv/config';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';

import config from '../config';
import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import User from '../models/User';
import Tenant from '../models/Tenant';
import { CATEGORY_CATALOG } from '../constants/categoryCatalog';
import { toDecimal, toDecimal128 } from '../utils/money';
import { createSnapshotIfNeeded } from '../workers/snapshotWorker';

const BENCHMARK_WALLET_COUNT = Number(process.env.GEN_WALLETS ?? '10');
const BENCHMARK_NAMES = Array.from({ length: BENCHMARK_WALLET_COUNT }, (_, index) => `benchmark-wallet-${index + 1}`);
const PER_WALLET = Number(process.env.GEN_PER_WALLET ?? '1200000');
const TOTAL = PER_WALLET * BENCHMARK_NAMES.length;
const DIRECT_BATCH_SIZE = Number(process.env.GEN_BATCH_SIZE ?? '2000');
const SNAPSHOT_API_EVERY = Number(process.env.GEN_SNAPSHOT_EVERY ?? '20000');
const EXPORT_START = new Date('2024-01-01T00:00:00.000Z');
const EXPORT_END = new Date('2024-12-31T00:00:00.000Z');

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount(): string {
  const amount = randInt(50, 100000);
  return String(amount);
}

function randomCategory(type: 'INCOME' | 'EXPENSE') {
  const items = CATEGORY_CATALOG.filter((category) => category.type === type);
  return items[randInt(0, items.length - 1)]._id;
}

function buildDateForIndex(globalIndex: number, total: number): Date {
  const windowMs = EXPORT_END.getTime() - EXPORT_START.getTime() - 1;
  const offsetMs = Math.floor((globalIndex * windowMs) / total);
  return new Date(EXPORT_START.getTime() + offsetMs);
}

function buildBalanceAwareTransaction(currentBalance: Decimal): { type: TransactionType; amount: Decimal } {
  const amount = new Decimal(randomAmount());
  let type = Math.random() < 0.5 ? TransactionType.INCOME : TransactionType.EXPENSE;

  if (type === TransactionType.EXPENSE) {
    const minSafeBalance = new Decimal(1);
    if (currentBalance.lte(minSafeBalance)) {
      type = TransactionType.INCOME;
      return { type, amount: new Decimal(Math.min(amount.toNumber(), 100000)) };
    }

    const maxExpense = currentBalance.minus(minSafeBalance);
    if (amount.gt(maxExpense)) {
      return { type: TransactionType.EXPENSE, amount: maxExpense };
    }
  }

  return { type, amount };
}

async function ensureTenantAndUser() {
  const tenant = await Tenant.findOneAndUpdate(
    { slug: 'benchmark-tenant' },
    { $setOnInsert: { name: 'Benchmark Tenant', slug: 'benchmark-tenant', status: 'ACTIVE', ownerId: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const user = await User.findOneAndUpdate(
    { email: 'benchmark-user@example.com' },
    {
      $setOnInsert: {
        googleId: 'benchmark-user',
        email: 'benchmark-user@example.com',
        name: 'Benchmark User',
        tenantId: tenant._id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!tenant.ownerId && user._id) {
    await Tenant.findByIdAndUpdate(tenant._id, { $set: { ownerId: user._id } });
  }

  if (!user.tenantId) {
    await User.findByIdAndUpdate(user._id, { $set: { tenantId: tenant._id } });
  }

  return { tenant, user };
}

async function ensureWalletForUser(name: string, tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
  const initialBalance = '1000000';
  return Wallet.findOneAndUpdate(
    { tenantId, userId, name },
    {
      $setOnInsert: {
        tenantId,
        userId,
        name,
        initialBalance: toDecimal128(initialBalance),
        initialBalanceDate: new Date('2024-01-01T00:00:00.000Z'),
        currentBalance: toDecimal128(initialBalance),
        version: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function refreshWalletBalance(walletId: mongoose.Types.ObjectId, tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
  const result = await Transaction.aggregate([
    { $match: { tenantId, userId, walletId } },
    { $project: { effect: { $switch: { branches: [
      { case: { $eq: ['$type', TransactionType.INCOME] }, then: '$amount' },
      { case: { $eq: ['$type', TransactionType.EXPENSE] }, then: { $multiply: ['$amount', -1] } },
    ], default: 0 } } } },
    { $group: { _id: null, total: { $sum: '$effect' } } },
  ]).exec();

  const totalEffect = toDecimal(result?.[0]?.total ?? '0');
  const wallet = await Wallet.findOne({ _id: walletId, tenantId, userId }).lean();
  const initial = toDecimal(wallet?.initialBalance ?? '0');
  const nextBalance = initial.plus(totalEffect);
  const safeBalance = nextBalance.isNegative() ? new Decimal(0) : nextBalance;

  await Wallet.findOneAndUpdate(
    { _id: walletId, tenantId, userId },
    { $set: { currentBalance: toDecimal128(safeBalance.toFixed(2)), version: (wallet?.version ?? 0) + 1 } },
  );
}

async function main() {
  console.log('Connecting to MongoDB', config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI);

  try {
    const { tenant, user } = await ensureTenantAndUser();
    const walletIds: string[] = [];
    let totalInserted = 0;
    let lastGeneratedDate = new Date(EXPORT_START.getTime() - 1);

    for (const name of BENCHMARK_NAMES) {
      const wallet = await ensureWalletForUser(name, tenant._id, user._id);
      walletIds.push(String(wallet._id));

      const per = PER_WALLET;
      let insertedForWallet = 0;
      let batch: Array<any> = [];
      let currentBalance = toDecimal(wallet.currentBalance ?? '1000000');

      for (let i = 0; i < per; i += 1) {
        const globalIndex = totalInserted + i;
        const { type, amount } = buildBalanceAwareTransaction(currentBalance);
        const rawDate = buildDateForIndex(globalIndex, TOTAL);
        const date = rawDate.getTime() <= lastGeneratedDate.getTime()
          ? new Date(lastGeneratedDate.getTime() + 1)
          : rawDate;
        lastGeneratedDate = date;

        if (type === TransactionType.INCOME) {
          currentBalance = currentBalance.plus(amount);
        } else {
          currentBalance = currentBalance.minus(amount);
        }

        batch.push({
          tenantId: tenant._id,
          userId: user._id,
          walletId: wallet._id,
          amount: toDecimal128(amount.toFixed(0)),
          type,
          category: randomCategory(type),
          date,
          note: 'bulk-generated-via-db',
        });

        if (batch.length >= DIRECT_BATCH_SIZE) {
          await Transaction.insertMany(batch, { ordered: false });
          insertedForWallet += batch.length;
          totalInserted += batch.length;
          batch = [];

          if (insertedForWallet % SNAPSHOT_API_EVERY === 0) {
            const snapshotResult = await createSnapshotIfNeeded(wallet._id, { tenantId: tenant._id });
            console.log(`snapshot checked after ${insertedForWallet} tx for wallet ${name}:`, snapshotResult);
          }
        }
      }

      if (batch.length > 0) {
        await Transaction.insertMany(batch, { ordered: false });
        insertedForWallet += batch.length;
        totalInserted += batch.length;
        batch = [];
      }

      if (insertedForWallet > 0 && insertedForWallet % SNAPSHOT_API_EVERY !== 0) {
        const snapshotResult = await createSnapshotIfNeeded(wallet._id, { tenantId: tenant._id });
        console.log(`final snapshot check for wallet ${name} after ${insertedForWallet} tx:`, snapshotResult);
      }

      await refreshWalletBalance(wallet._id, tenant._id, user._id);
      console.log(`wallet ${name} ready: inserted ${insertedForWallet}, walletId=${wallet._id}`);
    }

    console.log('ALL DONE');
    console.log(JSON.stringify({ walletIds, totalInserted, totalWallets: walletIds.length, perWallet: PER_WALLET }, null, 2));
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
