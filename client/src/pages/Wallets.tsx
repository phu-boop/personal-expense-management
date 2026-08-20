import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Plus, CreditCard, X, Eye, EyeOff, BarChart3, PlusCircle, ListFilter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api/api';
import './wallets.css';

interface Wallet {
  _id: string;
  name: string;
  accountNumber?: string;
  currentBalance: number;
  updatedAt: string;
}

const Wallets: React.FC = () => {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Per-wallet balance visibility state (default closed = false)
  const [visibleWalletBalances, setVisibleWalletBalances] = useState<{ [id: string]: boolean }>({});

  // Form State
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');

  const fetchWallets = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/api/wallets');
      setWallets(res.data);
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  const toggleWalletVisibility = (id: string) => {
    setVisibleWalletBalances(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleInitialBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setInitialBalance('');
      return;
    }
    const formatted = Number(rawDigits).toLocaleString('vi-VN');
    setInitialBalance(formatted);
  };

  const handleCreateWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/wallets', {
        name,
        accountNumber,
        initialBalance: Number(initialBalance.replace(/\D/g, '')) || 0,
        startDate: new Date().toISOString()
      });
      setIsModalOpen(false);
      setName('');
      setAccountNumber('');
      setInitialBalance('');
      fetchWallets(); // Refresh the list
    } catch (error) {
      console.error('Failed to create wallet:', error);
      alert('Failed to create wallet. Please check your inputs.');
    }
  };

  return (
    <div className="wallets-page">
      <header className="page-header">
        <div>
          <h1>Wallets</h1>
          <p className="subtitle">Manage your bank accounts and cash sources.</p>
        </div>
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={20} />
          Create Wallet
        </button>
      </header>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Loading wallets...</div>
      ) : wallets.length === 0 ? (
        <div className="empty-state">
          <p>No wallets found. Create one to get started!</p>
        </div>
      ) : (
        <div className="wallets-grid">
          {wallets.map(wallet => {
            const isVisible = !!visibleWalletBalances[wallet._id];
            return (
              <div key={wallet._id} className="card wallet-card glass-panel animate-fade-in">
                {/* Header row: Icon + Name/Account on Left, Eye Toggle on Right */}
                <div className="wallet-card-header">
                  <div className="wallet-header-main">
                    <div className="wallet-icon">
                      <CreditCard size={22} />
                    </div>
                    <div className="wallet-info">
                      <h3>{wallet.name}</h3>
                      {wallet.accountNumber && <p className="account-number">{wallet.accountNumber}</p>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="eye-toggle-btn"
                    onClick={() => toggleWalletVisibility(wallet._id)}
                    title={isVisible ? "Hide Balance" : "Show Balance"}
                  >
                    {isVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                </div>

                {/* Middle: Current Balance */}
                <div className="wallet-balance">
                  <p className="balance-label">Current Balance</p>
                  <h2>
                    {isVisible ? `${wallet.currentBalance.toLocaleString('vi-VN')} VND` : '•••••••• VND'}
                  </h2>
                </div>

                {/* Footer: Date updated + Smart Quick Action Buttons */}
                <div className="wallet-footer">
                  <span className="updated-date">Updated {new Date(wallet.updatedAt).toLocaleDateString('en-US')}</span>
                  <div className="wallet-actions">
                    <button
                      type="button"
                      className="wallet-action-btn"
                      title="View report for this wallet"
                      onClick={() => navigate(`/statement?walletId=${wallet._id}`)}
                    >
                      <BarChart3 size={15} />
                    </button>
                    <button
                      type="button"
                      className="wallet-action-btn"
                      title="Add transaction for this wallet"
                      onClick={() => navigate(`/transactions?walletId=${wallet._id}&action=new`)}
                    >
                      <PlusCircle size={15} />
                    </button>
                    <button
                      type="button"
                      className="wallet-action-btn"
                      title="View transactions for this wallet"
                      onClick={() => navigate(`/transactions?walletId=${wallet._id}`)}
                    >
                      <ListFilter size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wallet creation drawer */}
      {isModalOpen && ReactDOM.createPortal(
        <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}>
          <div className="drawer-content">
            <div className="drawer-header">
              <h2>Create New Wallet</h2>
              <button className="icon-btn" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateWallet} className="drawer-body">
              <div className="form-group">
                <label>Wallet Name (e.g. Vietcombank, Cash)</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Account Number (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="**** 1234"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Initial Balance (VND)</label>
                <input
                  type="text"
                  placeholder="0"
                  className="form-input"
                  required
                  value={initialBalance}
                  onChange={handleInitialBalanceChange}
                />
              </div>

              <div className="drawer-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Wallet</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Wallets;
