import api from './api';

export const wallets = {
  list: (params?: Record<string, any>) => api.get('/api/wallets', { params }),
  create: (payload: any) => api.post('/api/wallets', payload),
};

export const transactions = {
  list: (params?: Record<string, any>) => api.get('/api/transactions', { params }),
  listWithQueryString: (qs: string) => api.get(`/api/transactions?${qs}`),
  create: (payload: any) => api.post('/api/transactions', payload),
  statement: (params?: Record<string, any>) => api.get('/api/transactions/statement', { params }),
  insights: () => api.get('/api/transactions/insights'),
};

export const auth = {
  google: (payload: any) => api.post('/api/auth/google', payload),
};

export const exportsApi = {
  create: (payload: any) => api.post('/api/exports', payload),
  get: (jobId: string) => api.get(`/api/exports/${jobId}`),
  download: (jobId: string, opts?: any) => api.get(`/api/exports/${jobId}/download`, opts),
};

export default {
  wallets,
  transactions,
  auth,
  exports: exportsApi,
};
