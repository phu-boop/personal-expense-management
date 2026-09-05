import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Search, ArrowUpRight, ArrowDownRight, X, Folder, Edit } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import services from '../api/services';
import CustomSelect from '../components/CustomSelect';
import CustomDatePicker from '../components/CustomDatePicker';
import { formatMoney } from '../utils/formatMoney';
import './transactions.css';

interface Wallet {
  _id: string;
  name: string;
}

interface Transaction {
  _id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  category?: string | null;
  categoryName?: string;
  walletId: any;
  date: string;
  updatedAt?: string;
  note?: string;
  balanceAfter?: string;
  balanceBefore?: string;
}

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [openingBalance, setOpeningBalance] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [searchParams] = useSearchParams();
  const paramWalletId = searchParams.get('walletId') || '';
  const paramAction = searchParams.get('action') || '';

  type CategoryOption = { value: string; label: string };

  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterWallet, setFilterWallet] = useState(paramWalletId);
  const [filterCategory, setFilterCategory] = useState('');
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);

  const [txType, setTxType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const [submitError, setSubmitError] = useState('');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTxId(null);
    setSubmitError('');
  };

  const fetchWalletOptions = async () => {
    try {
      const walletsRes = await services.wallets.compact();
      const walletList = Array.isArray(walletsRes.data)
        ? walletsRes.data
        : Array.isArray(walletsRes.data?.items)
          ? walletsRes.data.items
          : Array.isArray(walletsRes.data?.data)
            ? walletsRes.data.data
            : [];

      const minimal: Array<{ _id: string; name: string }> = walletList.map((w: any) => ({ _id: w._id, name: w.name }));
      setWallets(minimal);
      return minimal;
    } catch (error) {
      console.error('Failed to fetch wallet options:', error);
      setWallets([]);
      return [] as Array<{ _id: string; name: string }>;
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await services.categories.list();
      const list = Array.isArray(res.data?.categories) ? res.data.categories : [];
      const mapped: CategoryOption[] = list.map((c: any) => ({ value: String(c._id), label: String(c.name) }));
      setCategoryOptions(mapped);

      if (mapped.length > 0 && !category) {
        setCategory(mapped.find((c: CategoryOption) => c.label === 'Food & Drink')?.value ?? mapped[0].value);
      }

      if (mapped.length > 0 && category && !mapped.some((c: CategoryOption) => c.value === category)) {
        const preferred = mapped.filter((c: CategoryOption) => c.value !== '').find((c: CategoryOption) => c.label === (txType === 'EXPENSE' ? 'Food & Drink' : 'Salary')) ?? mapped[0];
        setCategory(preferred.value);
      }
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      setCategoryOptions([]);
    }
  };

  const fetchData = async (append = false, cursor?: string | null) => {
    if (!append) setIsLoading(true);
    setIsLoadingMore(append);

    try {
      const limit = '20';
      const params: Record<string, any> = { limit };
      if (rangeFrom) params.from = new Date(rangeFrom + 'T00:00:00Z').toISOString();
      if (rangeTo) params.to = new Date(rangeTo + 'T00:00:00Z').toISOString();
      if (cursor) params.cursor = cursor;

      let walletList = wallets;
      if (walletList.length === 0) {
        walletList = await fetchWalletOptions();
      }

      let combinedTxs: Transaction[] = [];
      let nextC: string | null = null;
      let more = false;
      setOpeningBalance(null);

      const minimal: Array<{ _id: string; name: string }> = walletList.map((w: any) => ({ _id: w._id, name: w.name }));

      if (filterWallet) {
        const res = await services.transactions.list(filterWallet, params as any);
        const data = res.data;
        const txList = Array.isArray(data.transactions) ? data.transactions : (Array.isArray(data.data) ? data.data : []);
        combinedTxs = txList;
        nextC = data.nextCursor ?? null;
        more = Boolean(data.hasMore);
        setOpeningBalance(data.openingBalance ?? null);
      } else {
        const res = await services.transactions.listAll(params as any);
        const data = res.data;
        const txList = Array.isArray(data.transactions) ? data.transactions : (Array.isArray(data.data) ? data.data : []);
        combinedTxs = txList;
        nextC = data.nextCursor ?? null;
        more = Boolean(data.hasMore);
        setOpeningBalance(null);
      }

      const walletNameMap: Record<string, string> = {};
      minimal.forEach((w: { _id: string; name: string }) => { walletNameMap[w._id] = w.name; });

      const normalizedTxs = combinedTxs.map((tx: any) => {
        const wid = typeof tx.walletId === 'string' ? tx.walletId : (tx.walletId?._id ?? tx.walletId);
        return {
          ...tx,
          walletId: typeof wid === 'string' ? { _id: wid, name: walletNameMap[wid] ?? (typeof tx.walletId === 'object' ? tx.walletId.name : '') } : tx.walletId,
        } as Transaction;
      });

      normalizedTxs.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setTransactions(prev => append ? [...prev, ...normalizedTxs] : normalizedTxs);
      setNextCursor(nextC);
      setHasMore(more);
      setWallets(minimal);
      if (minimal.length > 0 && !walletId) {
        setWalletId(minimal[0]._id);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      if (!append) setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tyyyy = tomorrow.getFullYear();
      const tmm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const tdd = String(tomorrow.getDate()).padStart(2, '0');
      const tomorrowStr = `${tyyyy}-${tmm}-${tdd}`;

      if (!rangeFrom && !rangeTo) {
        setRangeFrom(todayStr);
        setRangeTo(tomorrowStr);
      }

      const walletList = await fetchWalletOptions();
      if (!filterWallet && walletList.length > 0) {
        const defaultWalletId = paramWalletId || '';
        setFilterWallet(defaultWalletId);
        setWalletId(defaultWalletId);
      }

      await fetchCategories();
      fetchData(false, null);
    };

    void initialize();
  }, []);

  useEffect(() => {
    if (paramWalletId) {
      setFilterWallet(paramWalletId);
      setWalletId(paramWalletId);
    }
    if (paramAction === 'new') {
      setIsModalOpen(true);
    }
  }, [searchParams, paramWalletId, paramAction]);

  const walletOptions = wallets.map(w => ({ value: w._id, label: w.name }));
  const categoryOptionsExpense = useMemo(
    () => categoryOptions.filter((c: CategoryOption) => c.label !== 'Salary' && c.label !== 'Business' && c.label !== 'Gift' && c.label !== 'Other Income'),
    [categoryOptions]
  );
  const categoryOptionsIncome = useMemo(
    () => categoryOptions.filter((c: CategoryOption) => c.label !== 'Food & Drink' && c.label !== 'Shopping' && c.label !== 'Transport' && c.label !== 'Bills' && c.label !== 'Entertainment' && c.label !== 'Other Expense'),
    [categoryOptions]
  );

  useEffect(() => {
    if (categoryOptions.length > 0 && !category) {
      const preferred = categoryOptions.find((c: CategoryOption) => c.label === (txType === 'EXPENSE' ? 'Food & Drink' : 'Salary')) ?? categoryOptions[0];
      setCategory(preferred.value);
    }
  }, [categoryOptions, txType, category]);

  useEffect(() => {
    if (categoryOptions.length > 0) {
      const currentTypeOptions = txType === 'EXPENSE' ? categoryOptionsExpense : categoryOptionsIncome;
      if (!currentTypeOptions.some((option: CategoryOption) => option.value === category)) {
        const preferred = currentTypeOptions[0];
        if (preferred) setCategory(preferred.value);
      }
    }
  }, [txType, categoryOptions, categoryOptionsExpense, categoryOptionsIncome, category]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setAmount('');
      return;
    }
    const formatted = Number(rawDigits).toLocaleString('vi-VN');
    setAmount(formatted);
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    try {
      const numericAmount = Number(amount.replace(/\D/g, ''));
      if (numericAmount <= 0) {
        setSubmitError('Please enter a valid amount');
        return;
      }

      if (!walletId) {
        setSubmitError('Please select a wallet');
        return;
      }

      const payload: any = {
        amount: String(numericAmount),
        type: txType,
        date: new Date(date).toISOString(),
      };
      if (note) payload.note = note;
      if (/^[a-f0-9]{24}$/i.test(category)) payload.category = category;

      if (editingTxId) {
        // Edit existing transaction
        await services.transactions.update(walletId, editingTxId, payload);
        setEditingTxId(null);
      } else {
        // Create new
        await services.transactions.create(walletId, payload);
      }

      setIsModalOpen(false);
      setAmount('');
      setNote('');
      // refresh list
      fetchData(false, null);
    } catch (error: any) {
      console.error('Failed to add transaction:', error);
      setSubmitError(error.response?.data?.message || 'Failed to add transaction');
    }
  };

  const formatTransactionTime = (value?: string, fallbackDate?: string) => {
    const raw = value || fallbackDate;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const filteredAndGroupedTransactions = useMemo(() => {
    let filtered = transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(tx =>
        (tx.categoryName ?? tx.category ?? '').toLowerCase().includes(q) ||
        (tx.note && tx.note.toLowerCase().includes(q))
      );
    }
    if (filterWallet) {
      filtered = filtered.filter(tx => tx.walletId?._id === filterWallet);
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
      const amt = typeof tx.amount === 'string' ? Number(tx.amount) : Number(tx.amount || 0);
      if (tx.type === 'INCOME') grouped[dateKey].totalIncome += amt;
      if (tx.type === 'EXPENSE') grouped[dateKey].totalExpense += amt;
    });

    return Object.values(grouped).sort((a, b) => b.dateVal.getTime() - a.dateVal.getTime());
  }, [transactions, searchQuery, filterWallet, filterCategory]);

  const uniqueCategories = useMemo(() => {
    const cats = new Map<string, string>();
    transactions.forEach((tx) => {
      if (tx.category && tx.categoryName) {
        cats.set(tx.category, tx.categoryName);
      }
    });
    return Array.from(cats.entries()).map(([value, label]) => ({ value, label }));
  }, [transactions]);

  return (
    <div className="transactions-page">
      <header className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="subtitle">Manage and track your income and expenses.</p>
        </div>
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={20} />
          Add Transaction
        </button>
      </header>

      <div className="card transaction-list-card">
        {openingBalance !== null && (
          <div className="opening-balance-card">
            <strong>Opening Balance:</strong>
            <span style={{ marginLeft: 8 }}>{formatMoney(Number(openingBalance))} VND</span>
          </div>
        )}
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>From</label>
                <div style={{ width: 160 }}>
                  <CustomDatePicker value={rangeFrom ?? ''} onChange={(v) => setRangeFrom(v || null)} placeholder="From" />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>To</label>
                <div style={{ width: 160 }}>
                  <CustomDatePicker value={rangeTo ?? ''} onChange={(v) => setRangeTo(v || null)} placeholder="To" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-secondary" onClick={() => fetchData(false, null)}>Apply</button>
                <button className="btn-secondary" onClick={() => { setRangeFrom(null); setRangeTo(null); fetchData(false, null); }}>Clear</button>
              </div>
            </div>
            <CustomSelect
              value={filterCategory}
              onChange={setFilterCategory}
              options={[{value: '', label: 'All Categories'}, ...uniqueCategories]}
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
              <button className="btn-primary" onClick={() => setIsModalOpen(true)}>Add Transaction</button>
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
                      {group.totalIncome > 0 && <span className="income-sum">+{formatMoney(group.totalIncome)}</span>}
                      {group.totalExpense > 0 && <span className="expense-sum">-{formatMoney(group.totalExpense)}</span>}
                    </div>
                  </div>
                  <div className="date-group-items">
                    {group.transactions.map((tx) => {
                      const hasBalanceInfo = tx.balanceBefore !== null && tx.balanceBefore !== undefined && tx.balanceAfter !== null && tx.balanceAfter !== undefined;
                      const timeLabel = formatTransactionTime(tx.updatedAt, tx.date);

                      return (
                        <div key={tx._id} className="transaction-row">
                          <div className={`tx-icon-wrapper ${tx.type.toLowerCase()}`}>
                            {tx.type === 'INCOME' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                          </div>
                          <div className="tx-details">
                            <div className="tx-category">{tx.categoryName ?? tx.category ?? 'Uncategorized'}</div>
                            <div className="tx-note-row">
                              <span className="tx-note">{tx.note ? `${tx.note}${tx.walletId?.name ? ' • ' : ''}` : ''}{tx.walletId?.name}</span>
                              {timeLabel && <span className="tx-time">{timeLabel}</span>}
                            </div>
                          </div>
                          <div className="tx-meta">
                            <div className="tx-balances">
                              {hasBalanceInfo ? (
                                <>
                                  <div className="tx-balance-before">{formatMoney(Number(tx.balanceBefore))} VND</div>
                                  <div className={`tx-amount ${tx.type.toLowerCase()}`}>{tx.type === 'INCOME' ? '+' : '-'}{formatMoney((typeof tx.amount === 'string' ? Number(tx.amount) : tx.amount))} VND</div>
                                  <div className="tx-balance-after">{formatMoney(Number(tx.balanceAfter))} VND</div>
                                </>
                              ) : (
                                <div className={`tx-amount ${tx.type.toLowerCase()}`}>{tx.type === 'INCOME' ? '+' : '-'}{formatMoney((typeof tx.amount === 'string' ? Number(tx.amount) : tx.amount))} VND</div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button className="icon-btn edit-tx-btn" title="Edit" onClick={() => {
                                // open modal in edit mode
                                setEditingTxId(tx._id);
                                setIsModalOpen(true);
                                setTxType(tx.type);
                                setAmount((typeof tx.amount === 'string' ? Number(tx.amount) : tx.amount).toLocaleString('vi-VN'));
                                setWalletId(tx.walletId?._id || '');
                                setCategory(tx.category || (txType === 'EXPENSE' ? (categoryOptionsExpense[0]?.value ?? '') : (categoryOptionsIncome[0]?.value ?? '')));
                                setDate(new Date(tx.date).toISOString().split('T')[0]);
                                setNote(tx.note || '');
                              }}>
                                <Edit size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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

      {isModalOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}>
          <div className="drawer-content">
            <div className="drawer-header">
              <h2>{editingTxId ? 'Edit Transaction' : 'Add Transaction'}</h2>
              <button className="icon-btn" onClick={closeModal}>
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleAddTransaction} className="drawer-body">
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
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className={`btn-primary ${txType.toLowerCase()}-btn`}>
                  {editingTxId ? `Save ${txType === 'INCOME' ? 'Income' : 'Expense'}` : `Add ${txType === 'INCOME' ? 'Income' : 'Expense'}`}
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
