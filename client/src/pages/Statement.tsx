import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Download, Folder } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import services from '../api/services';
import CustomSelect from '../components/CustomSelect';
import CustomDatePicker from '../components/CustomDatePicker';
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

interface Wallet {
  _id: string;
  name: string;
}

interface ExportQueueItem {
  id: number;
  fileName: string;
  status: 'processing' | 'done' | 'error';
  step: string;
  progress: number;
}

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
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);
  const [exportQueue, setExportQueue] = useState<ExportQueueItem[]>([]);

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
      const walletList = findFirstArray(resp) || [];
      console.debug('fetchWallets: parsed length', walletList.length, walletList[0] ?? null);
      setWallets(walletList.map((w: any) => services.normalizeWallet(w)));
      return walletList;
    } catch (err) {
      console.error('fetchWallets error', err);
      setWallets([]);
      return [] as any[];
    }
  };

  const fetchStatementForWallet = async (wid?: string) => {
    console.debug('fetchStatementForWallet: start', { walletId: wid });
    try {
      const statementRes = await services.statement.get(wid || '', { from: startDate, to: endDate } as any);
      console.debug('fetchStatementForWallet: raw', statementRes);
      setSummary(statementRes.data?.summary ?? { openingBalance: 0, totalIncome: 0, totalExpense: 0, closingBalance: 0 });
      setTransactions(Array.isArray(statementRes.data?.transactions) ? statementRes.data.transactions : []);
      return statementRes;
    } catch (err) {
      console.error('fetchStatementForWallet error', err);
      setSummary({ openingBalance: 0, totalIncome: 0, totalExpense: 0, closingBalance: 0 });
      setTransactions([]);
      return null;
    }
  };

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const walletList = await fetchWallets();
      if (!walletId && walletList.length > 0) {
        const firstId = String(walletList[0]._id ?? walletList[0].id ?? '');
        if (firstId) {
          console.debug('fetchAll: defaulting walletId to', firstId);
          setWalletId(firstId);
          await fetchStatementForWallet(firstId);
          return;
        }
      }
      await fetchStatementForWallet(walletId);
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

  const addExportQueueTask = (fileName: string, step: string, progress: number): number => {
    const taskId = Date.now() + Math.random();
    const task: ExportQueueItem = {
      id: taskId,
      fileName,
      status: 'processing',
      step,
      progress,
    };

    setExportQueue((previous) => [task, ...previous].slice(0, 3));
    return taskId;
  };

  const updateExportQueueTask = (taskId: number, updates: Partial<ExportQueueItem>) => {
    setExportQueue((previous) => previous.map((task) => (task.id === taskId ? { ...task, ...updates } : task)));
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

      let pollAttempts = 0;
      const maxPollAttempts = 40;

      const pollForCompletion = async (): Promise<void> => {
        pollAttempts += 1;

        if (pollAttempts > maxPollAttempts) {
          updateExportQueueTask(taskId, {
            status: 'error',
            step: 'Hết thời gian chờ xuất file',
            progress: 100,
          });
          throw new Error('Export polling timed out.');
        }

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
            setExportQueue((previous) => previous.filter((task) => task.id !== taskId));
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
          progress: Math.min(90, 35 + pollAttempts * 2),
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

      {exportQueue.length > 0 && ReactDOM.createPortal(
        <div className="export-queue-floating">
          <div className="export-queue-panel">
            <div className="export-queue-header">Processing: {exportQueue.filter((task) => task.status === 'processing').length || 1}</div>
            {exportQueue.map((task) => (
              <div key={task.id} className={`export-queue-card ${task.status}`}>
                <div className="export-progress-bar">
                  <span className="export-progress-fill" style={{ width: `${task.progress}%` }} />
                </div>
                <div className="export-task-name">{task.fileName}</div>
                <div className="export-task-state">{task.step}</div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

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
          <div className="summary-value">{summary.openingBalance.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Income</div>
          <div className="summary-value income">+{summary.totalIncome.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Expense</div>
          <div className="summary-value expense">-{summary.totalExpense.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item highlight">
          <div className="summary-label">Closing Balance</div>
          <div className="summary-value">{summary.closingBalance.toLocaleString('vi-VN')} VND</div>
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
                    {tx.type === 'INCOME' ? `+${tx.amount.toLocaleString('vi-VN')} VND` : '-'}
                  </td>
                  <td data-label="Expense" className="right-align expense-col">
                    {tx.type === 'EXPENSE' ? `-${tx.amount.toLocaleString('vi-VN')} VND` : '-'}
                  </td>
                  <td data-label="Balance" className="right-align balance-col">
                    {tx.balanceAfter.toLocaleString('vi-VN')} VND
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Statement;
