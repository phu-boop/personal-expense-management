import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Transaction, { TransactionType } from './models/Transaction';
import User from './models/User';
import Wallet from './models/Wallet';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
const userId = new mongoose.Types.ObjectId('6a873535cb4f9555079a5fa4');
const accountId = new mongoose.Types.ObjectId('6a87736febb90c7e6c5e9c44');

const walletSeeds = [
  {
    _id: accountId,
    name: 'gsfgd',
    accountNumber: '5345345',
    colorTheme: 'emerald',
    initialBalance: 500000,
    currentBalance: 500000,
    startDate: '2026-08-20T21:36:47.844Z',
  },
  {
    _id: new mongoose.Types.ObjectId('6a87736febb90c7e6c5e9c45'),
    name: 'Ví tiền mặt',
    accountNumber: 'CASH-001',
    colorTheme: 'amber',
    initialBalance: 2500000,
    currentBalance: 2145000,
    startDate: '2026-08-01T08:00:00.000Z',
  },
  {
    _id: new mongoose.Types.ObjectId('6a87736febb90c7e6c5e9c46'),
    name: 'Tài khoản lương',
    accountNumber: 'BANK-001',
    colorTheme: 'blue',
    initialBalance: 12000000,
    currentBalance: 10550000,
    startDate: '2026-08-01T08:00:00.000Z',
  },
  {
    _id: new mongoose.Types.ObjectId('6a87736febb90c7e6c5e9c47'),
    name: 'Tiết kiệm',
    accountNumber: 'SAVE-001',
    colorTheme: 'violet',
    initialBalance: 20000000,
    currentBalance: 20000000,
    startDate: '2026-07-01T08:00:00.000Z',
  },
  {
    _id: new mongoose.Types.ObjectId('6a87736febb90c7e6c5e9c48'),
    name: 'Ví du lịch',
    accountNumber: 'TRAVEL-001',
    colorTheme: 'rose',
    initialBalance: 5000000,
    currentBalance: 3650000,
    startDate: '2026-08-05T08:00:00.000Z',
  },
];

const transactionSeeds = [
  { id: '6a87736febb90c7e6c5e9d01', walletIndex: 1, type: TransactionType.EXPENSE, amount: 150000, category: 'Ăn uống', date: '2026-08-20T12:00:00.000Z', note: 'Ăn trưa' },
  { id: '6a87736febb90c7e6c5e9d02', walletIndex: 1, type: TransactionType.EXPENSE, amount: 85000, category: 'Di chuyển', date: '2026-08-19T08:30:00.000Z', note: 'Đổ xăng' },
  { id: '6a87736febb90c7e6c5e9d03', walletIndex: 1, type: TransactionType.EXPENSE, amount: 120000, category: 'Mua sắm', date: '2026-08-18T17:00:00.000Z', note: 'Đồ dùng cá nhân' },
  { id: '6a87736febb90c7e6c5e9d04', walletIndex: 2, type: TransactionType.INCOME, amount: 12000000, category: 'Lương', date: '2026-08-15T09:00:00.000Z', note: 'Lương tháng 8' },
  { id: '6a87736febb90c7e6c5e9d05', walletIndex: 2, type: TransactionType.EXPENSE, amount: 1000000, category: 'Nhà ở', date: '2026-08-16T09:00:00.000Z', note: 'Tiền thuê nhà' },
  { id: '6a87736febb90c7e6c5e9d06', walletIndex: 2, type: TransactionType.EXPENSE, amount: 450000, category: 'Hóa đơn', date: '2026-08-17T09:00:00.000Z', note: 'Điện nước internet' },
  { id: '6a87736febb90c7e6c5e9d07', walletIndex: 3, type: TransactionType.INCOME, amount: 3000000, category: 'Tiết kiệm', date: '2026-08-10T09:00:00.000Z', note: 'Nạp thêm vào tiết kiệm' },
  { id: '6a87736febb90c7e6c5e9d08', walletIndex: 4, type: TransactionType.EXPENSE, amount: 750000, category: 'Du lịch', date: '2026-08-12T10:00:00.000Z', note: 'Vé máy bay' },
  { id: '6a87736febb90c7e6c5e9d09', walletIndex: 4, type: TransactionType.EXPENSE, amount: 600000, category: 'Du lịch', date: '2026-08-13T10:00:00.000Z', note: 'Khách sạn' },
  { id: '6a87736febb90c7e6c5e9d10', walletIndex: 4, type: TransactionType.EXPENSE, amount: 150000, category: 'Du lịch', date: '2026-08-14T10:00:00.000Z', note: 'Ăn uống trong chuyến đi' },
];

const colors = ['emerald', 'amber', 'blue', 'violet', 'rose', 'cyan', 'orange', 'teal'];
const categories = ['Ăn uống', 'Di chuyển', 'Mua sắm', 'Hóa đơn', 'Giải trí', 'Sức khỏe', 'Giáo dục', 'Khác'];

const stableObjectId = (value: number) => new mongoose.Types.ObjectId(value.toString(16).padStart(24, '0'));

for (let index = walletSeeds.length; index < 50; index += 1) {
  const initialBalance = 1000000 + (index * 375000);
  const spent = (index % 5 + 1) * 85000;

  walletSeeds.push({
    _id: stableObjectId(1000 + index),
    name: `Ví mẫu ${String(index + 1).padStart(2, '0')}`,
    accountNumber: `DEMO-${String(index + 1).padStart(3, '0')}`,
    colorTheme: colors[index % colors.length],
    initialBalance,
    currentBalance: initialBalance - spent,
    startDate: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
  });
}

for (let index = transactionSeeds.length; index < 100; index += 1) {
  const walletIndex = index % walletSeeds.length;
  const type = index % 5 === 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
  const amount = type === TransactionType.INCOME
    ? 250000 + ((index % 6) * 100000)
    : 45000 + ((index % 8) * 25000);

  transactionSeeds.push({
    id: stableObjectId(2000 + index).toHexString(),
    walletIndex,
    type,
    amount,
    category: type === TransactionType.INCOME ? 'Thu nhập khác' : categories[index % categories.length],
    date: `2026-08-${String((index % 20) + 1).padStart(2, '0')}T${String((index % 10) + 8).padStart(2, '0')}:00:00.000Z`,
    note: `Giao dịch mẫu ${String(index + 1).padStart(3, '0')}`,
  });
}

const seed = async () => {
  await mongoose.connect(mongoUri);

  await User.updateOne(
    { _id: userId },
    {
      $set: { name: 'Demo User', avatar: '' },
      $setOnInsert: {
        googleId: 'seed-demo-user',
        email: 'demo.expense@example.com',
      },
    },
    { upsert: true },
  );

  await Wallet.bulkWrite(
    walletSeeds.map((wallet) => ({
      updateOne: {
        filter: { _id: wallet._id },
        update: {
          $set: { ...wallet, userId, startDate: new Date(wallet.startDate) },
        },
        upsert: true,
      },
    })),
  );

  await Transaction.bulkWrite(
    transactionSeeds.map((transaction) => {
      const wallet = walletSeeds[transaction.walletIndex];
      const balanceAfter = transaction.type === TransactionType.INCOME
        ? wallet.currentBalance
        : wallet.currentBalance - transaction.amount;
      const balanceBefore = transaction.type === TransactionType.INCOME
        ? wallet.currentBalance - transaction.amount
        : wallet.currentBalance;

      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(transaction.id) },
          update: {
            $set: {
              userId,
              walletId: wallet._id,
              type: transaction.type,
              amount: transaction.amount,
              category: transaction.category,
              date: new Date(transaction.date),
              note: transaction.note,
              balanceBefore,
              balanceAfter,
            },
          },
          upsert: true,
        },
      };
    }),
  );

  console.log(`Seeded ${walletSeeds.length} wallets and ${transactionSeeds.length} transactions successfully`);
};

seed()
  .catch((error) => {
    console.error('Failed to seed account', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });