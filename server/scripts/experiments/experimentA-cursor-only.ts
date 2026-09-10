import mongoose from 'mongoose';
import { Transaction } from '../../src/models/Transaction';

function maybeObjectId(id?: string) {
  if (!id) return undefined;
  try {
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  } catch (e) {
    // ignore
  }
  return id;
}

async function main() {
  const mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27017';
  const dbName = process.env.MONGO_DB || 'personal_expense';
  console.log('Using MONGO_URL:', mongoUri);
  console.log('Using MONGO_DB:', dbName);
  await mongoose.connect(mongoUri, { dbName });

  // Build match from optional environment variables, do NOT hard-code ids
  const match: any = {};
  const tenantId = maybeObjectId(process.env.TENANT_ID);
  const walletId = maybeObjectId(process.env.WALLET_ID);
  const userId = maybeObjectId(process.env.USER_ID);
  if (tenantId) match.tenantId = tenantId;
  if (walletId) match.walletId = walletId;
  if (userId) match.userId = userId;

  console.log('Using match filter:', match);

  const connDbName = mongoose.connection.db?.databaseName;
  const collectionName = (Transaction.collection && Transaction.collection.name) || 'transactions';

  // Diagnostics: total and matched counts
  const totalCount = await Transaction.estimatedDocumentCount();
  const matchedCount = await Transaction.countDocuments(match);
  console.log('Connected DB:', connDbName);
  console.log('Collection:', collectionName);
  console.log('Total documents in collection (estimated):', totalCount);
  console.log('Documents matching filter:', matchedCount);

  if (matchedCount === 0) {
    console.warn('No documents match the filter. If you expected data, try running without TENANT_ID/WALLET_ID/USER_ID env vars.');
  }

  const cursor = Transaction.find(match).lean().cursor();

  let seen = 0;
  const thresholds = new Set([10000, 50000, 100000, 200000, 500000, 1000000]);

  console.log('Starting cursor-only experiment');
  for await (const doc of cursor) {
    seen++;
    if (thresholds.has(seen)) {
      const mem = process.memoryUsage();
      console.log(`seen=${seen} rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB external=${Math.round(mem.external/1024/1024)}MB arrayBuffers=${Math.round((mem.arrayBuffers||0)/1024/1024)}MB heapTotal=${Math.round(mem.heapTotal/1024/1024)}MB`);
      if ((global as any).gc) {
        (global as any).gc();
        const mem2 = process.memoryUsage();
        console.log(`after gc: heapUsed=${Math.round(mem2.heapUsed/1024/1024)}MB`);
      }
    }
  }

  console.log('Cursor completed, seen=', seen);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
