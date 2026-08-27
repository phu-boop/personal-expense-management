import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Search, ArrowUpRight, ArrowDownRight, X, Folder } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/api';
import CustomSelect from '../components/CustomSelect';
import CustomDatePicker from '../components/CustomDatePicker';
import './transactions.css';

interface Wallet {
  _id: string;
  name: string;
}

interface Transaction {
  _id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  walletId: Wallet | string;
  date: string;
  note?: string;
  balanceAfter: number;
}

interface TransactionAuditLog {
  _id: string;
  transactionId: string;
  changedAt: string;
  changeReason: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
}

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [searchParams] = useSearchParams();
  const paramWalletId = searchParams.get('walletId') || '';
  const paramAction = searchParams.get('action') || '';

  const [searchQuery, setSearchQuery] = useState('');
  const [filterWallet, setFilterWallet] = useState(paramWalletId);
  const [filterCategory, setFilterCategory] = useState('');

  const [txType, setTxType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState('Food & Drink'); // Default
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const [submitError, setSubmitError] = useState('');
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isUserHistoryOpen, setIsUserHistoryOpen] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<TransactionAuditLog[]>([]);
  const [historyTransaction, setHistoryTransaction] = useState<Transaction | null>(null);
  const [userHistoryLogs, setUserHistoryLogs] = useState<TransactionAuditLog[]>([]);

  const normalizeDateValue = (value: string) => {
    const parsed = new Date(`${value}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  };

  const resetForm = (preferredWalletId?: string) => {
    const fallbackWalletId = preferredWalletId ?? (paramWalletId || wallets[0]?._id || '');
    setTxType('EXPENSE');
    setAmount('');
    setWalletId(fallbackWalletId);
    setCategory('Food & Drink');
    setDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setSubmitError('');
  };

  const openAddModal = () => {
    setEditingTransactionId(null);
    resetForm(paramWalletId || wallets[0]?._id || '');
    setIsModalOpen(true);
  };

  const openEditModal = (tx: Transaction) => {
    const walletValue = typeof tx.walletId === 'string' ? tx.walletId : tx.walletId?._id || '';
    setEditingTransactionId(tx._id);
    setTxType(tx.type);
    setAmount(String(tx.amount));
    setWalletId(walletValue);
    setCategory(tx.category);
    setDate(new Date(tx.date).toISOString().split('T')[0]);
    setNote(tx.note || '');
    setSubmitError('');
    setIsModalOpen(true);
  };

  const fetchData = async (append = false, cursor?: string | null) => {
    if (!append) setIsLoading(true);
    setIsLoadingMore(append);

    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('before', cursor);
      if (filterWallet) params.set('walletId', filterWallet);
      if (filterCategory) params.set('category', filterCategory);

      const [txRes, walletsRes] = await Promise.all([
        api.get(`/api/transactions?${params.toString()}`),
        api.get('/api/wallets')
      ]);

      const walletList = Array.isArray(walletsRes.data) ? walletsRes.data : (walletsRes.data?.data ?? []);
      const txList = Array.isArray(txRes.data?.data) ? txRes.data.data : [];

      setTransactions(prev => append ? [...prev, ...txList] : txList);
      setNextCursor(txRes.data?.nextCursor ?? null);
      setHasMore(Boolean(txRes.data?.hasMore));
      setWallets(walletList);
      if (walletList.length > 0 && !walletId) {
        setWalletId(walletList[0]._id);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      if (!append) setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchData(false, null);
  }, []);

  useEffect(() => {
    if (!walletId && wallets.length > 0) {
      setWalletId(wallets[0]._id);
      return;
    }

    fetchData(false, null);
  }, [filterWallet, filterCategory]);

  useEffect(() => {
    if (paramWalletId) {
      setFilterWallet(paramWalletId);
      setWalletId(paramWalletId);
    }

    if (paramAction === 'new') {
      setEditingTransactionId(null);
      resetForm(paramWalletId || wallets[0]?._id || '');
      setIsModalOpen(true);
    }
  }, [searchParams, paramWalletId, paramAction, wallets]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setAmount('');
      return;
    }
    const formatted = Number(rawDigits).toLocaleString('vi-VN');
    setAmount(formatted);
  };

  const formatAuditValue = (value: any) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return value.toLocaleString('vi-VN');
    if (value instanceof Date || !Number.isNaN(Date.parse(value))) {
      return new Date(value).toLocaleString('vi-VN');
    }
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  };

  const summarizeAuditDiff = (log: TransactionAuditLog) => {
    const oldValues = log.oldValues ?? {};
    const newValues = log.newValues ?? {};
    const allKeys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]));

    return allKeys
      .filter((key) => oldValues[key] !== newValues[key])
      .map((key) => {
        const oldValue = oldValues[key];
        const newValue = newValues[key];

        if (key === 'amount') {
          return `Số tiền: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)} VND`;
        }

        if (key === 'date') {
          return `Ngày: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
        }

        if (key === 'type') {
          return `Loại: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
        }

        if (key === 'category') {
          return `Danh mục: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
        }

        if (key === 'note') {
          return `Ghi chú: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
        }

        if (key === 'status') {
          return `Trạng thái: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
        }

        return `${key}: ${formatAuditValue(oldValue)} → ${formatAuditValue(newValue)}`;
      });
  };

  const fetchAuditHistory = async (tx: Transaction) => {
    try {
      const res = await api.get(`/api/transactions/${tx._id}/audit`);
      setHistoryTransaction(tx);
      setHistoryLogs(res.data?.data ?? []);
      setIsHistoryOpen(true);
    } catch (error) {
      console.error('Failed to load transaction audit history:', error);
      setHistoryTransaction(tx);
      setHistoryLogs([]);
      setIsHistoryOpen(true);
    }
  };

  const fetchUserAuditHistory = async () => {
    try {
      const res = await api.get('/api/transactions/audit');
      setUserHistoryLogs(res.data?.data ?? []);
      setIsUserHistoryOpen(true);
    } catch (error) {
      console.error('Failed to load user audit history:', error);
      setUserHistoryLogs([]);
      setIsUserHistoryOpen(true);
    }
  };

  const handleSubmitTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setIsSubmitting(true);

    try {
      const numericAmount = Number(amount.replace(/\D/g, ''));
      if (numericAmount <= 0) {
        setSubmitError('Please enter a valid amount');
        return;
      }

      const payload = {
        walletId,
        type: txType,
        amount: numericAmount,
        category,
        date: normalizeDateValue(date),
        note,
      };

      if (editingTransactionId) {
        await api.patch(`/api/transactions/${editingTransactionId}`, payload);
      } else {
        await api.post('/api/transactions', payload);
      }

      setIsModalOpen(false);
      resetForm();
      setEditingTransactionId(null);
      await fetchData();
    } catch (error: any) {
      console.error('Failed to save transaction:', error);
      setSubmitError(error.response?.data?.message || (editingTransactionId ? 'Failed to update transaction' : 'Failed to add transaction'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAndGroupedTransactions = useMemo(() => {
    let filtered = transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(tx =>
        tx.category.toLowerCase().includes(q) ||
        (tx.note && tx.note.toLowerCase().includes(q))
      );
    }
    if (filterWallet) {
      filtered = filtered.filter(tx => {
        const walletValue = typeof tx.walletId === 'string' ? tx.walletId : tx.walletId?._id;
        return walletValue === filterWallet;
      });
    }
    if (filterCategory) {
      filtered = filtered.filter(tx => tx.category === filterCategory);
    }

    const grouped: { [key: string]: { dateVal: Date, transactions: Transaction[], totalIncome: number, totalExpense: number } } = {};

    filtered.forEach(tx => {
      const txDate = new Date(tx.date);
      const dateKey = `${txDate.getFullYear()}-${txDate.getMonth() + 1}-${txDate.getDate()}`;

      if (!grouped[dateKey]) {
        grouped[dateKey] = { dateVal: txDate, transactions: [], totalIncome: 0, totalExpense: 0 };
      }
      grouped[dateKey].transactions.push(tx);
      if (tx.type === 'INCOME') grouped[dateKey].totalIncome += tx.amount;
      if (tx.type === 'EXPENSE') grouped[dateKey].totalExpense += tx.amount;
    });

    return Object.values(grouped).sort((a, b) => b.dateVal.getTime() - a.dateVal.getTime());
  }, [transactions, searchQuery, filterWallet, filterCategory]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(transactions.map(tx => tx.category));
    return Array.from(cats);
  }, [transactions]);

  const walletOptions = wallets.map(w => ({ value: w._id, label: w.name }));
  const categoryOptionsExpense = [
    { value: 'Food & Drink', label: 'Food & Drink' },
    { value: 'Shopping', label: 'Shopping' },
    { value: 'Transport', label: 'Transport' },
    { value: 'Bills', label: 'Bills' },
    { value: 'Entertainment', label: 'Entertainment' },
    { value: 'Other Expense', label: 'Other Expense' }
  ];
  const categoryOptionsIncome = [
    { value: 'Salary', label: 'Salary' },
    { value: 'Business', label: 'Business' },
    { value: 'Gift', label: 'Gift' },
    { value: 'Other Income', label: 'Other Income' }
  ];

  return (
    <div className="transactions-page">
      <header className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="subtitle">Manage and track your income and expenses.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={openAddModal}>
            <Plus size={20} />
            Add Transaction
          </button>
          <button className="btn-secondary" onClick={fetchUserAuditHistory}>
            Audit History
          </button>
        </div>
      </header>

      <div className="card transaction-list-card">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search by category or note..."
              className="search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filters">
            <CustomSelect
              value={filterWallet}
              onChange={setFilterWallet}
              options={[{value: '', label: 'All Wallets'}, ...walletOptions]}
              placeholder="All Wallets"
              style={{ minWidth: '150px' }}
            />
            <CustomSelect
              value={filterCategory}
              onChange={setFilterCategory}
              options={[{value: '', label: 'All Categories'}, ...uniqueCategories.map(c => ({value: c, label: c}))]}
              placeholder="All Categories"
              style={{ minWidth: '150px' }}
            />
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading transactions...</div>
        ) : filteredAndGroupedTransactions.length === 0 ? (
          <div className="empty-data-panel">
            <div className="empty-data-icon">
              <Folder size={28} />
            </div>
            <strong>{transactions.length === 0 ? 'No transactions found.' : 'No transactions match your filters.'}</strong>
            <span>
              {transactions.length === 0
                ? 'Click "Add Transaction" to record your first income or expense.'
                : 'Try changing the wallet or category filters to see more records.'}
            </span>
            {transactions.length === 0 && (
              <button className="btn-primary" onClick={openAddModal}>Add Transaction</button>
            )}
          </div>
        ) : (
          <div className="transaction-list">
            {filteredAndGroupedTransactions.map((group) => {
              const d = group.dateVal;
              const today = new Date();
              const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

              let displayDate = d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

              if (d.toDateString() === today.toDateString()) {
                displayDate = 'Today, ' + displayDate;
              } else if (d.toDateString() === yesterday.toDateString()) {
                displayDate = 'Yesterday, ' + displayDate;
              }

              return (
                <div key={d.toISOString()} className="date-group animate-fade-in">
                  <div className="date-group-header">
                    <div className="date-title">{displayDate}</div>
                    <div className="date-summary">
                      {group.totalIncome > 0 && <span className="income-sum">+{group.totalIncome.toLocaleString('vi-VN')}</span>}
                      {group.totalExpense > 0 && <span className="expense-sum">-{group.totalExpense.toLocaleString('vi-VN')}</span>}
                    </div>
                  </div>
                  <div className="date-group-items">
                    {group.transactions.map((tx) => (
                      <div key={tx._id} className="transaction-row">
                        <div className={`tx-icon-wrapper ${tx.type.toLowerCase()}`}>
                          {tx.type === 'INCOME' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        </div>
                        <div className="tx-details">
                          <div className="tx-category">{tx.category}</div>
                          <div className="tx-note">{tx.note ? `${tx.note} • ` : ''}{typeof tx.walletId === 'string' ? tx.walletId : tx.walletId?.name}</div>
                        </div>
                        <div className="tx-meta">
                          <div className={`tx-amount ${tx.type.toLowerCase()}`}>
                            {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('vi-VN')} VND
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              onClick={() => openEditModal(tx)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              onClick={() => fetchAuditHistory(tx)}
                            >
                              History
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', paddingBottom: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fetchData(true, nextCursor)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isUserHistoryOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setIsUserHistoryOpen(false); setUserHistoryLogs([]); } }}>
          <div className="drawer-content audit-history-drawer">
            <div className="drawer-header audit-history-header">
              <div>
                <p className="audit-history-kicker">Activity</p>
                <h2>User Audit History</h2>
              </div>
              <button className="icon-btn" onClick={() => { setIsUserHistoryOpen(false); setUserHistoryLogs([]); }}>
                <X size={24} />
              </button>
            </div>

            <div className="drawer-body audit-history-body">
              {userHistoryLogs.length === 0 ? (
                <div className="audit-history-empty">
                  <div className="audit-history-empty-icon">!</div>
                  <strong>No audit history found.</strong>
                  <span>There are no activity logs for this account yet.</span>
                </div>
              ) : (
                <>
                  <div className="audit-history-summary">
                    <div className="audit-history-stat">
                      <span>Total records</span>
                      <strong>{userHistoryLogs.length}</strong>
                    </div>
                  </div>

                  <div className="audit-history-list">
                    {userHistoryLogs.map((log) => {
                      const diffs = summarizeAuditDiff(log);
                      return (
                        <div key={log._id} className="audit-history-item">
                          <div className="audit-history-item-top">
                            <div className="audit-history-reason-wrap">
                              <span className="audit-history-badge">Update</span>
                              <strong>{log.changeReason}</strong>
                            </div>
                            <span className="audit-history-time">{new Date(log.changedAt).toLocaleString('vi-VN')}</span>
                          </div>

                          <div className="audit-history-details">
                            <div className="audit-history-transaction">
                              <span>Transaction</span>
                              <strong>{log.transactionId}</strong>
                            </div>
                            {diffs.length > 0 ? (
                              <div className="audit-history-diff">
                                {diffs.map((item, index) => (
                                  <div key={`${log._id}-${index}`} className="audit-history-diff-item">• {item}</div>
                                ))}
                              </div>
                            ) : (
                              <div className="audit-history-diff-item muted">• Không có thay đổi chi tiết.</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isHistoryOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setIsHistoryOpen(false); setHistoryTransaction(null); setHistoryLogs([]); } }}>
          <div className="drawer-content" style={{ maxWidth: '520px' }}>
            <div className="drawer-header">
              <h2>Transaction History</h2>
              <button className="icon-btn" onClick={() => { setIsHistoryOpen(false); setHistoryTransaction(null); setHistoryLogs([]); }}>
                <X size={24} />
              </button>
            </div>

            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {historyTransaction && (
                <div style={{ background: 'var(--surface-soft)', borderRadius: '12px', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{historyTransaction.category}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {historyTransaction.type === 'INCOME' ? '+' : '-'}{historyTransaction.amount.toLocaleString('vi-VN')} VND • {new Date(historyTransaction.date).toLocaleDateString('vi-VN')}
                  </div>
                </div>
              )}

              {historyLogs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem 0' }}>No edit history yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {historyLogs.map((log) => {
                    const diffs = summarizeAuditDiff(log);
                    return (
                      <div key={log._id} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '0.75rem 0.9rem', background: 'var(--surface-soft)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                          <strong>{log.changeReason}</strong>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(log.changedAt).toLocaleString('vi-VN')}</span>
                        </div>

                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                          {diffs.length > 0 ? (
                            diffs.map((item, index) => (
                              <div key={`${log._id}-${index}`}>• {item}</div>
                            ))
                          ) : (
                            <div>• Không có thay đổi chi tiết.</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isModalOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setIsModalOpen(false); setEditingTransactionId(null); resetForm(); } }}>
          <div className="drawer-content">
            <div className="drawer-header">
              <h2>{editingTransactionId ? 'Edit Transaction' : 'Add Transaction'}</h2>
              <button className="icon-btn" onClick={() => { setIsModalOpen(false); setEditingTransactionId(null); resetForm(); }}>
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmitTransaction} className="drawer-body">
              {submitError && <div style={{ color: 'var(--expense)', marginBottom: '1rem', fontSize: '14px' }}>{submitError}</div>}

              <div className="type-toggle">
                <button
                  type="button"
                  className={`toggle-btn ${txType === 'INCOME' ? 'active income' : ''}`}
                  onClick={() => setTxType('INCOME')}
                >
                  Income
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${txType === 'EXPENSE' ? 'active expense' : ''}`}
                  onClick={() => setTxType('EXPENSE')}
                >
                  Expense
                </button>
              </div>

              <div className="form-group">
                <label>Amount (VND)</label>
                <input
                  type="text"
                  placeholder="0"
                  className={`form-input amount-input ${txType.toLowerCase()}`}
                  value={amount}
                  onChange={handleAmountChange}
                  required
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Wallet</label>
                  <CustomSelect
                    value={walletId}
                    onChange={setWalletId}
                    options={walletOptions}
                    placeholder="Select Wallet"
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <CustomSelect
                    value={category}
                    onChange={setCategory}
                    options={txType === 'EXPENSE' ? categoryOptionsExpense : categoryOptionsIncome}
                    placeholder="Select Category"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Date</label>
                <CustomDatePicker value={date} onChange={setDate} placeholder="Select Date" />
              </div>

              <div className="form-group">
                <label>Note (Optional)</label>
                <input
                  type="text"
                  placeholder="What was this for?"
                  className="form-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn-secondary" onClick={() => { setIsModalOpen(false); setEditingTransactionId(null); resetForm(); }}>Cancel</button>
                <button type="submit" className={`btn-primary ${txType.toLowerCase()}-btn`} disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : (editingTransactionId ? 'Save Changes' : `Add ${txType === 'INCOME' ? 'Income' : 'Expense'}`)}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Transactions;
