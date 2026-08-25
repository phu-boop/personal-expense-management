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

const PAGE_SIZE = 20;

const Wallets: React.FC = () => {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [visibleWalletBalances, setVisibleWalletBalances] = useState<{ [id: string]: boolean }>({});

  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');

  const fetchWallets = async (nextPage = page) => {
    setIsLoading(true);
    try {
      const res = await api.get('/api/wallets', {
        params: { page: nextPage, limit: PAGE_SIZE }
      });

      const walletList = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      const nextTotalPages = Math.max(1, Number(res.data?.totalPages ?? 1));

      setWallets(walletList);
      setTotalPages(nextTotalPages);
      setPage(Number(res.data?.page ?? nextPage));
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets(page);
  }, [page]);

  const toggleWalletVisibility = (id: string) => {
    setVisibleWalletBalances(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleOpeningBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setOpeningBalance('');
      return;
    }
    const formatted = Number(rawDigits).toLocaleString('vi-VN');
    setOpeningBalance(formatted);
  };

  const handleCreateWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/wallets', {
        name,
        accountNumber,
        openingBalance: Number(openingBalance.replace(/\D/g, '')) || 0,
        openingDate: new Date().toISOString()
      });
      setIsModalOpen(false);
      setName('');
      setAccountNumber('');
      setOpeningBalance('');
      fetchWallets();
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
        <>
          <div className="wallets-shell">
            <div className="wallets-grid">
              {wallets.map(wallet => {
                const isVisible = !!visibleWalletBalances[wallet._id];
                return (
                  <div key={wallet._id} className="card wallet-card glass-panel animate-fade-in">
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

                    <div className="wallet-balance">
                      <p className="balance-label">Current Balance</p>
                      <h2>
                        {isVisible ? `${wallet.currentBalance.toLocaleString('vi-VN')} VND` : '•••••••• VND'}
                      </h2>
                    </div>

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

            <div className="pagination-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </button>
              <span className="pagination-text">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

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
                  value={openingBalance}
                  onChange={handleOpeningBalanceChange}
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
