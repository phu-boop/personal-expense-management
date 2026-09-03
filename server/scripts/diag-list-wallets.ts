import mongoose from 'mongoose';

async function run() {
  const uri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/pem_test';
  await mongoose.connect(uri);
  const Wallet = require('../src/models/Wallet').default;
  const docs = await Wallet.find().lean();
  console.log('Wallets count:', docs.length);
  console.dir(docs, { depth: 3 });
  await mongoose.disconnect();
}

run().catch(e=>{console.error(e);process.exit(1)});
