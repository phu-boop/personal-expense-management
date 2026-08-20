import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Search, ArrowUpRight, ArrowDownRight, X } from 'lucide-react';
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
  walletId: Wallet;
  date: string;
  note?: string;
  balanceAfter: number;
}

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const paramWalletId = searchParams.get('walletId') || '';
  const paramAction = searchParams.get('action') || '';

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterWallet, setFilterWallet] = useState(paramWalletId);
  const [filterCategory, setFilterCategory] = useState('');

  // Form State
  const [txType, setTxType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState('Food & Drink'); // Default
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const [submitError, setSubmitError] = useState('');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [txRes, walletsRes] = await Promise.all([
        api.get('/api/transactions?limit=1000'),
        api.get('/api/wallets')
      ]);
      setTransactions(txRes.data.data);
      setWallets(walletsRes.data);
      if (walletsRes.data.length > 0) {
        setWalletId(walletsRes.data[0]._id);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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

      await api.post('/api/transactions', {
        walletId,
        type: txType,
        amount: numericAmount,
        category,
        date,
        note
      });
      setIsModalOpen(false);
      setAmount('');
      setNote('');
      fetchData(); // Refresh list
    } catch (error: any) {
      console.error('Failed to add transaction:', error);
      setSubmitError(error.response?.data?.message || 'Failed to add transaction');
    }
  };

  // Filter and Group Logic
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
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={20} />
          Add Transaction
        </button>
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
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {transactions.length === 0 ? 'No transactions found. Click "Add Transaction" to create one.' : 'No transactions match your filters.'}
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
                          <div className={`tx-amount ${tx.type.toLowerCase()}`}>
                            {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('vi-VN')} VND
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}>
          <div className="drawer-content">
            <div className="drawer-header">
              <h2>Add Transaction</h2>
              <button className="icon-btn" onClick={() => setIsModalOpen(false)}>
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
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className={`btn-primary ${txType.toLowerCase()}-btn`}>
                  Add {txType === 'INCOME' ? 'Income' : 'Expense'}
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
