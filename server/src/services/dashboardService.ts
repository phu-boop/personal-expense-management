import mongoose from 'mongoose';
import Decimal from 'decimal.js';

import Transaction, { TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import { toDecimal } from '../utils/money';

export type DashboardRequest = {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
};

export type DashboardRecentTransaction = {
  _id: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  walletName: string;
  amount: string;
  type: TransactionType;
  date: Date;
  note?: string;
  category?: mongoose.Types.ObjectId | null;
  createdAt: Date;
};

export type DashboardMonthlyPoint = {
  month: string;
  income: string;
  expense: string;
  net: string;
};

export type DashboardCategoryPoint = {
  category: string;
  total: string;
  count: number;
};

export type DashboardResponse = {
  totalBalance: string;
  activeWallets: number;
  incomeThisMonth: string;
  expenseThisMonth: string;
  netThisMonth: string;
  recentTransactions: DashboardRecentTransaction[];
  monthlyTrend: DashboardMonthlyPoint[];
  categoryBreakdown: DashboardCategoryPoint[];
};

const formatMoney = (value: Decimal | string | number) => toDecimal(value).toFixed(2);

const buildUtcMonthRange = (referenceDate: Date) => {
  const monthStart = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const nextMonth = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { monthStart, nextMonth };
};

export async function getDashboard({ tenantId, userId }: DashboardRequest): Promise<DashboardResponse> {
  const wallets = await Wallet.find({ tenantId, userId }, { _id: 1, name: 1, currentBalance: 1 }).lean();

  const totalBalance = wallets.reduce((sum, wallet) => sum.plus(toDecimal(wallet.currentBalance ?? '0')), new Decimal(0));

  const now = new Date();
  const { monthStart: currentMonthStart, nextMonth: currentMonthEnd } = buildUtcMonthRange(now);
  const sixMonthsStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1, 0, 0, 0, 0));

  const trendWindow = {
    $gte: sixMonthsStart,
    $lt: currentMonthEnd,
  };

  const aggregation = await Transaction.aggregate([
    {
      $match: {
        tenantId,
        userId,
        date: trendWindow,
      },
    },
    {
      $facet: {
        summary: [
          { $match: { date: { $gte: currentMonthStart, $lt: currentMonthEnd } } },
          {
            $group: {
              _id: null,
              income: {
                $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] },
              },
              expense: {
                $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] },
              },
            },
          },
        ],
        trend: [
          {
            $project: {
              month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' } },
              income: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] },
              expense: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] },
            },
          },
          {
            $group: {
              _id: '$month',
              income: { $sum: '$income' },
              expense: { $sum: '$expense' },
            },
          },
          { $project: { _id: 0, month: '$_id', income: 1, expense: 1, net: { $subtract: ['$income', '$expense'] } } },
          { $sort: { month: 1 } },
        ],
        categories: [
          { $match: { date: { $gte: currentMonthStart, $lt: currentMonthEnd } } },
          {
            $group: {
              _id: '$category',
              total: {
                $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { total: -1, count: -1 } },
          { $limit: 5 },
        ],
      },
    },
  ]).exec();

  const [dashboardStats] = aggregation;
  const summary = dashboardStats?.summary?.[0] ?? { income: 0, expense: 0 };
  const incomeThisMonth = toDecimal(summary.income ?? 0);
  const expenseThisMonth = toDecimal(summary.expense ?? 0);
  const netThisMonth = incomeThisMonth.minus(expenseThisMonth);

  const trendMap = new Map((dashboardStats?.trend ?? []).map((item) => [item.month, item]));
  const monthlyTrend: DashboardMonthlyPoint[] = [];

  for (let index = 5; index >= 0; index -= 1) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1, 0, 0, 0, 0));
    const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthData = trendMap.get(monthKey) ?? { income: 0, expense: 0, net: 0 };

    monthlyTrend.push({
      month: monthKey,
      income: formatMoney(monthData.income ?? 0),
      expense: formatMoney(monthData.expense ?? 0),
      net: formatMoney((monthData.net ?? toDecimal(monthData.income ?? 0).minus(toDecimal(monthData.expense ?? 0))).toString ? (monthData.net ?? toDecimal(monthData.income ?? 0).minus(toDecimal(monthData.expense ?? 0))) : monthData.net ?? 0),
    });
  }

  const categoryBreakdown: DashboardCategoryPoint[] = (dashboardStats?.categories ?? []).map((row) => ({
    category: row._id ? row._id.toString() : 'Uncategorized',
    total: formatMoney(row.total ?? 0),
    count: row.count ?? 0,
  }));

  const recentTransactions = await Transaction.find({ tenantId, userId })
    .sort({ date: -1, createdAt: -1, _id: -1 })
    .limit(5)
    .lean();

  const walletById = new Map<string, string>(wallets.map((wallet) => [wallet._id.toString(), wallet.name]));

  const mappedRecentTransactions: DashboardRecentTransaction[] = recentTransactions.map((tx) => ({
    _id: tx._id,
    walletId: tx.walletId,
    walletName: walletById.get(tx.walletId.toString()) ?? 'Wallet',
    amount: formatMoney(tx.amount),
    type: tx.type,
    date: tx.date,
    note: tx.note,
    category: tx.category ?? null,
    createdAt: tx.createdAt,
  }));

  return {
    totalBalance: formatMoney(totalBalance),
    activeWallets: wallets.length,
    incomeThisMonth: formatMoney(incomeThisMonth),
    expenseThisMonth: formatMoney(expenseThisMonth),
    netThisMonth: formatMoney(netThisMonth),
    recentTransactions: mappedRecentTransactions,
    monthlyTrend,
    categoryBreakdown,
  };
}
