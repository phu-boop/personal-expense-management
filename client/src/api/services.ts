import api from './api';

export const wallets = {
  // allow passing axios config as second arg to control cache headers etc.
  list: (params?: Record<string, any>, config?: Record<string, any>) => api.get('/api/wallets', { params, ...(config || {}) }),
  // compact list returns items at top-level (no data wrapper)
  compact: (params?: Record<string, any>, config?: Record<string, any>) => api.get('/api/wallets/compact', { params, ...(config || {}) }),
  create: (payload: any) => api.post('/api/wallets', payload),
  get: (walletId: string) => api.get(`/api/wallets/${walletId}`),
};

export const normalizeWallet = (w: any) => {
  const currentBalanceRaw = w?.currentBalance ?? w?.balance ?? 0;
  const initialBalanceRaw = w?.initialBalance ?? 0;
  const toNumber = (v: any) => {
    if (v == null) return 0;
    if (typeof v === 'string' || typeof v === 'number') return Number(v);
    if (v?.$numberDecimal) return Number(v.$numberDecimal);
    return Number(v);
  };

  return {
    ...w,
    currentBalance: toNumber(currentBalanceRaw),
    initialBalance: toNumber(initialBalanceRaw),
    updatedAt: w.updatedAt ?? w.createdAt,
  };
};

export const normalizeWalletList = (arr: any[]) => Array.isArray(arr) ? arr.map(normalizeWallet) : [];

/**
 * Transaction APIs follow contract: all are under /api/wallets/:walletId/transactions
 */
export const transactions = {
  // GET /api/wallets/:walletId/transactions?from=&to=&limit=&cursor=
  list: (walletId: string, params?: Record<string, any>) => api.get(`/api/wallets/${walletId}/transactions`, { params }),
  // POST /api/wallets/:walletId/transactions
  create: (walletId: string, payload: any) => api.post(`/api/wallets/${walletId}/transactions`, payload),
  // PATCH /api/wallets/:walletId/transactions/:transactionId
  update: (walletId: string, transactionId: string, payload: any) => api.patch(`/api/wallets/${walletId}/transactions/${transactionId}`, payload),
};

export const statement = {
  // GET /api/wallets/:walletId/statement?from=&to=
  get: (walletId: string, params?: Record<string, any>) => api.get(`/api/wallets/${walletId}/statement`, { params }),
};

export const auth = {
  google: (payload: any) => api.post('/api/auth/google', payload),
};

export const exportsApi = {
  create: (payload: any) => api.post('/api/exports', payload),
  get: (jobId: string) => api.get(`/api/exports/${jobId}`),
  download: (jobId: string, opts?: any) => api.get(`/api/exports/${jobId}/download`, opts),
};

/**
 * Utilities / mocks for non-contract endpoints (insights, global transactions)
 */
export const mock = {
  // Merge recent transactions across wallets by fetching per-wallet lists (best-effort)
  async recentAcrossWallets(limit = 5) {
    const walletsRes = await wallets.list();
    const walletList = Array.isArray(walletsRes.data) ? walletsRes.data : (walletsRes.data?.data ?? []);

    const fetches = walletList.map((w: any) =>
      transactions.list(w._id, { limit }).then(r => ({ walletId: w._id, data: r.data })).catch(() => ({ walletId: w._id, data: null }))
    );

    const results = await Promise.all(fetches);
    const aggregated: any[] = [];
    results.forEach((r: any) => {
      if (!r.data) return;
      const txs = Array.isArray(r.data.transactions) ? r.data.transactions : (Array.isArray(r.data.data) ? r.data.data : []);
      txs.forEach((t: any) => aggregated.push(t));
    });
    // sort by date desc
    aggregated.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return aggregated.slice(0, limit);
  }
};

const defaultExport = {
  wallets,
  transactions,
  statement,
  auth,
  exports: exportsApi,
  mock,
  normalizeWallet,
  normalizeWalletList,
};

export default defaultExport;

