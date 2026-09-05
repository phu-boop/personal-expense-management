import React, { useState, useEffect, useRef } from 'react';
import { Download, Folder } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import services from '../api/services';
import CustomSelect from '../components/CustomSelect';
import CustomDatePicker from '../components/CustomDatePicker';
import { useExportQueue } from '../contexts/ExportQueueContext';
import { formatMoney } from '../utils/formatMoney';
import './statement.css';

interface Summary {
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
}

interface Transaction {
  _id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  date: string;
  note?: string;
  balanceAfter: number;
}

const toNumber = (value: unknown): number => {
  if (value == null) return 0;

  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const maybeDecimal = (value as any)?.$numberDecimal;
    if (typeof maybeDecimal === 'string') {
      const parsed = Number(maybeDecimal);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }

  const parsed = Number(value as any);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStatementResponse = (payload: any) => {
  const summarySource = payload?.summary ?? payload ?? {};

  return {
    summary: {
      openingBalance: toNumber(summarySource.openingBalance),
      totalIncome: toNumber(summarySource.totalIncome),
      totalExpense: toNumber(summarySource.totalExpense),
      closingBalance: toNumber(summarySource.closingBalance),
    },
    transactions: Array.isArray(summarySource.transactions) ? summarySource.transactions.map((tx: any) => ({
      ...tx,
      amount: toNumber(tx?.amount),
      balanceAfter: toNumber(tx?.balanceAfter),
      balanceBefore: toNumber(tx?.balanceBefore),
    })) : [],
  };
};

interface Wallet {
  _id: string;
  name: string;
}

const PAGE_SIZE = 20;

const Statement: React.FC = () => {
  const [summary, setSummary] = useState<Summary>({
    openingBalance: 0,
    totalIncome: 0,
    totalExpense: 0,
    closingBalance: 0
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);
  const { addExportQueueTask, updateExportQueueTask, removeExportQueueTask } = useExportQueue();

  const now = new Date();
  const defaultEndDate = now.toISOString().slice(0, 10);
  const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);

  // Split fetching flows for clearer logs and debugging
  const findFirstArray = (obj: any, depth = 3): any[] | null => {
    if (!obj || depth < 0) return null;
    if (Array.isArray(obj)) return obj;
    if (typeof obj !== 'object') return null;
    for (const k of Object.keys(obj)) {
      try {
        const v = (obj as any)[k];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object') {
          const found = findFirstArray(v, depth - 1);
          if (found) return found;
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  };

  const fetchWallets = async () => {
    console.debug('fetchWallets: start');
    try {
      const walletsRes = await services.wallets.compact();
      console.debug('fetchWallets: raw', walletsRes);
      const resp = walletsRes?.data ?? walletsRes;
      const walletList = Array.isArray(resp)
        ? resp
        : Array.isArray(resp?.items)
          ? resp.items
          : Array.isArray(resp?.data)
            ? resp.data
            : findFirstArray(resp) || [];
      console.debug('fetchWallets: parsed length', walletList.length, walletList[0] ?? null);
      setWallets(walletList.map((w: any) => ({
        _id: w._id,
        name: w.name,
      })));
      return walletList;
    } catch (err) {
      console.error('fetchWallets error', err);
      setWallets([]);
      return [] as any[];
    }
  };

  const fetchStatementForWallet = async (wid?: string, cursorOverride?: string | null, append = false) => {
    console.debug('fetchStatementForWallet: start', { walletId: wid, append, cursorOverride });
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      const params: any = {
        from: startDate,
        to: endDate,
        limit: PAGE_SIZE,
      };
      if (cursorOverride) params.cursor = cursorOverride;

      const statementRes = await services.statement.get(wid || '', params);
      console.debug('fetchStatementForWallet: raw', statementRes);

      const normalized = normalizeStatementResponse(statementRes.data ?? {});
      const payloadTransactions = normalized.transactions as Transaction[];

      if (append) {
        setTransactions((prev) => [...prev, ...payloadTransactions]);
      } else {
        setSummary(normalized.summary);
        setTransactions(payloadTransactions);
      }

      setNextCursor(statementRes.data?.nextCursor ?? null);
      setHasMore(Boolean(statementRes.data?.nextCursor));
      return statementRes;
    } catch (err) {
      console.error('fetchStatementForWallet error', err);
      if (!append) {
        setSummary({ openingBalance: 0, totalIncome: 0, totalExpense: 0, closingBalance: 0 });
        setTransactions([]);
      }
      setNextCursor(null);
      setHasMore(false);
      return null;
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  };

  const fetchAll = async () => {
    try {
      const walletList = await fetchWallets();
      if (!walletId && walletList.length > 0) {
        const firstId = String(walletList[0]._id ?? walletList[0].id ?? '');
        if (firstId) {
          console.debug('fetchAll: defaulting walletId to', firstId);
          setWalletId(firstId);
          await fetchStatementForWallet(firstId, null, false);
          return;
        }
      }
      await fetchStatementForWallet(walletId, null, false);
    } finally {
      setIsLoading(false);
    }
  };

  const [searchParams] = useSearchParams();
  const initialWalletId = searchParams.get('walletId') || '';

  const [walletId, setWalletId] = useState(initialWalletId);
  useEffect(() => {
    const paramWalletId = searchParams.get('walletId');
    if (paramWalletId) {
      setWalletId(paramWalletId);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchAll();
  }, [walletId, startDate, endDate]);

  const handleGenerate = () => {
    fetchAll();
  };

  const exportFile = async (format: 'xlsx' | 'pdf') => {
    if (isExportingRef.current) {
      return;
    }

    isExportingRef.current = true;

    try {
      setIsExporting(true);

      const fileName = `statement_${startDate}_to_${endDate}.${format}`;
      const taskId = addExportQueueTask(fileName, 'Preparing file...', 18);

      const payload = {
        walletId: walletId || undefined,
        startDate,
        endDate,
        format,
      };

      const createRes = await services.exports.create(payload);
      const jobId = createRes.data.jobId;
      updateExportQueueTask(taskId, { step: 'Generating report...', progress: 35 });

      const pollForCompletion = async (): Promise<void> => {
        const jobRes = await services.exports.get(jobId);
        const status = jobRes.data.status;

        if (status === 'COMPLETED') {
          updateExportQueueTask(taskId, {
            step: 'Ready to download',
            status: 'done',
            progress: 100,
          });

          try {
            const resp = await services.exports.download(jobId, { responseType: 'blob' });
            const blob = resp.data as Blob;
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(url);
          } catch (downloadErr) {
            const errorWithResponse = downloadErr as { response?: { status?: number } } | undefined;
            const status = errorWithResponse?.response?.status ?? 'unknown';
            console.error('Download error:', downloadErr);
            updateExportQueueTask(taskId, { status: 'error', step: `Download failed: ${status}`, progress: 100 });
            setIsExporting(false);
            throw downloadErr;
          }

          window.setTimeout(() => {
            removeExportQueueTask(taskId);
          }, 1800);

          setIsExporting(false);
          return;
        }

        if (status === 'FAILED' || status === 'EXPIRED') {
          updateExportQueueTask(taskId, {
            status: 'error',
            step: jobRes.data.message || 'Xuất file thất bại',
            progress: 100,
          });
          throw new Error(jobRes.data.message || 'Export failed.');
        }

        updateExportQueueTask(taskId, {
          step: 'Generating report...',
          progress: Math.min(90, 35 + 2),
        });

        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        return pollForCompletion();
      };

      await pollForCompletion();
    } catch (error) {
      console.error('Failed to export statement:', error);
      setIsExporting(false);
    } finally {
      isExportingRef.current = false;
      if (!isExportingRef.current) {
        setIsExporting(false);
      }
    }
  };

  return (
    <div className="statement-page">
      <header className="page-header">
        <div>
          <h1>Statement & Reports</h1>
          <p className="subtitle">View detailed financial statements and export data.</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => exportFile('pdf')} disabled={isExporting}>
            <Download size={18} /> {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
          <button className="btn-secondary" onClick={() => exportFile('xlsx')} disabled={isExporting}>
            <Download size={18} /> {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>
      </header>

      <div className="card filters-card glass-panel animate-fade-in">
        <div className="filter-group">
          <label>Wallet {wallets.length > 0 ? `(${wallets.length})` : '(0)'}</label>
          <CustomSelect
            value={walletId}
            onChange={setWalletId}
            options={[{ value: '', label: 'All Wallets' }, ...wallets.map(w => ({ value: w._id, label: w.name }))]}
            placeholder="All Wallets"
          />
        </div>
        <div className="filter-group">
          <label>From Date</label>
          <CustomDatePicker value={startDate} onChange={setStartDate} placeholder="From Date" />
        </div>
        <div className="filter-group">
          <label>To Date</label>
          <CustomDatePicker value={endDate} onChange={setEndDate} placeholder="To Date" />
        </div>
        <div className="filter-group button-group">
          <button className="btn-primary" onClick={handleGenerate}>
            Generate
          </button>
        </div>
      </div>

      <div className="statement-summary-grid animate-fade-in">
        <div className="summary-item">
          <div className="summary-label">Opening Balance</div>
          <div className="summary-value">{formatMoney(summary.openingBalance)} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Income</div>
          <div className="summary-value income">+{formatMoney(summary.totalIncome)} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Expense</div>
          <div className="summary-value expense">-{formatMoney(summary.totalExpense)} VND</div>
        </div>
        <div className="summary-item highlight">
          <div className="summary-label">Closing Balance</div>
          <div className="summary-value">{formatMoney(summary.closingBalance)} VND</div>
        </div>
      </div>

      <div className="card statement-table-card animate-fade-in">
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading statement...</div>
        ) : transactions.length === 0 ? (
          <div className="empty-data-panel statement-empty-panel">
            <div className="empty-data-icon">
              <Folder size={28} />
            </div>
            <strong>No transactions found for this period.</strong>
            <span>Choose another date range or add a new transaction to generate a statement.</span>
          </div>
        ) : (
          <>
            <table className="statement-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right-align">Income</th>
                  <th className="right-align">Expense</th>
                  <th className="right-align">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx._id}>
                    <td data-label="Date" className="tx-date-col">{new Date(tx.date).toLocaleDateString()}</td>
                    <td data-label="Description">
                      <div className="tx-desc">{tx.note || tx.category}</div>
                      <div className="tx-cat">{tx.category}</div>
                    </td>
                    <td data-label="Income" className="right-align income-col">
                      {tx.type === 'INCOME' ? `+${formatMoney(tx.amount)} VND` : '-'}
                    </td>
                    <td data-label="Expense" className="right-align expense-col">
                      {tx.type === 'EXPENSE' ? `-${formatMoney(tx.amount)} VND` : '-'}
                    </td>
                    <td data-label="Balance" className="right-align balance-col">
                      {formatMoney(tx.balanceAfter)} VND
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0 0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fetchStatementForWallet(walletId, nextCursor, true)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Statement;
