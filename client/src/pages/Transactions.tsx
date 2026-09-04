import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Search, ArrowUpRight, ArrowDownRight, X, Folder, Edit } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import services from '../api/services';
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
  // backend may return amount as string (decimal)
  amount: string;
  category: string;
  walletId: any;
  date: string;
  note?: string;
  // server-derived balances are strings as well
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

  const [searchQuery, setSearchQuery] = useState('');
  const [filterWallet, setFilterWallet] = useState(paramWalletId);
  const [filterCategory, setFilterCategory] = useState('');
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);

  const [txType, setTxType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState('Food & Drink'); // Default
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const [submitError, setSubmitError] = useState('');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTxId(null);
    setSubmitError('');
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

      // prefer compact wallet list for lightweight select options
      const walletsRes = await services.wallets.compact();
      const walletList = Array.isArray(walletsRes.data) ? walletsRes.data : (walletsRes.data?.items ?? []);

      let combinedTxs: Transaction[] = [];
      let nextC: string | null = null;
      let more = false;

      if (filterWallet) {
        // Use contract endpoint per-wallet
        const res = await services.transactions.list(filterWallet, params as any);
        const data = res.data;
        const txList = Array.isArray(data.transactions) ? data.transactions : (Array.isArray(data.data) ? data.data : []);
        combinedTxs = txList;
        nextC = data.nextCursor ?? null;
        more = Boolean(data.hasMore);
        // opening balance provided by contract
        setOpeningBalance(data.openingBalance ?? null);
      } else {
        // No wallet filter: aggregate across wallets (mock behavior)
        const fetches = walletList.map((w: any) =>
          services.transactions.list(w._id, params as any).then((r: any) => ({ walletId: w._id, data: r.data })).catch(() => null)
        );
        const results = await Promise.all(fetches);
        results.forEach((r: any) => {
          if (!r || !r.data) return;
          const txs = Array.isArray(r.data.transactions) ? r.data.transactions : (Array.isArray(r.data.data) ? r.data.data : []);
          txs.forEach((t: Transaction) => combinedTxs.push(t));
        });
        // Sort and limit
        combinedTxs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        combinedTxs = combinedTxs.slice(0, Number(limit));
        nextC = null;
        more = false;
      }

      // normalize transaction walletId to include wallet name for UI
      const walletNameMap: Record<string, string> = {};
      const minimal: Array<{ _id: string; name: string }> = walletList.map((w: any) => ({ _id: w._id, name: w.name }));
      minimal.forEach((w: { _id: string; name: string }) => { walletNameMap[w._id] = w.name; });

      const normalizedTxs = combinedTxs.map((tx: any) => {
        const wid = typeof tx.walletId === 'string' ? tx.walletId : (tx.walletId?._id ?? tx.walletId);
        return {
          ...tx,
          walletId: typeof wid === 'string' ? { _id: wid, name: walletNameMap[wid] ?? '' } : tx.walletId,
        } as Transaction;
      });

      // sort newest -> oldest
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
    // default date range: today -> tomorrow
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
      // fetch with defaults
      fetchData(false, null);
      return;
    }

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
      setIsModalOpen(true);
    }
  }, [searchParams, paramWalletId, paramAction]);

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
      // send category only if it looks like an ObjectId
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
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={20} />
          Add Transaction
        </button>
      </header>

      <div className="card transaction-list-card">
        {openingBalance !== null && (
          <div className="opening-balance-card">
            <strong>Opening Balance:</strong>
            <span style={{ marginLeft: 8 }}>{Number(openingBalance).toLocaleString('vi-VN')} VND</span>
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
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>From</label>
              <input type="date" value={rangeFrom ?? ''} onChange={(e) => setRangeFrom(e.target.value || null)} />
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>To</label>
              <input type="date" value={rangeTo ?? ''} onChange={(e) => setRangeTo(e.target.value || null)} />
              <button className="btn-secondary" onClick={() => fetchData(false, null)}>Apply</button>
              <button className="btn-secondary" onClick={() => { setRangeFrom(null); setRangeTo(null); fetchData(false, null); }}>Clear</button>
            </div>
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
                          <div className="tx-note">{tx.note ? `${tx.note} • ` : ''}{tx.walletId?.name}</div>
                        </div>
                        <div className="tx-meta">
                          <div className="tx-balances">
                            <div className="tx-balance-before">{Number(tx.balanceBefore ?? tx.balanceBefore).toLocaleString('vi-VN')} VND</div>
                            <div className={`tx-amount ${tx.type.toLowerCase()}`}>{tx.type === 'INCOME' ? '+' : '-'}{(typeof tx.amount === 'string' ? Number(tx.amount) : tx.amount).toLocaleString('vi-VN')} VND</div>
                            <div className="tx-balance-after">{Number(tx.balanceAfter ?? tx.balanceAfter).toLocaleString('vi-VN')} VND</div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="icon-btn edit-tx-btn" title="Edit" onClick={() => {
                              // open modal in edit mode
                              setEditingTxId(tx._id);
                              setIsModalOpen(true);
                              setTxType(tx.type);
                              setAmount((typeof tx.amount === 'string' ? Number(tx.amount) : tx.amount).toLocaleString('vi-VN'));
                              setWalletId(tx.walletId?._id || '');
                              setCategory(tx.category || '');
                              setDate(new Date(tx.date).toISOString().split('T')[0]);
                              setNote(tx.note || '');
                            }}>
                              <Edit size={16} />
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
