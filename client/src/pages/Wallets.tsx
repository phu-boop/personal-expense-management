import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Plus, CreditCard, X, Eye, EyeOff, BarChart3, PlusCircle, ListFilter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api/api';
import services from '../api/services';
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
  // cursor pagination state
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursorValue, setNextCursorValue] = useState<string | null>(null);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [visibleWalletBalances, setVisibleWalletBalances] = useState<{ [id: string]: boolean }>({});

  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');

  const fetchWallets = async (cursor?: string | null) => {
    setIsLoading(true);
    try {
      const params: any = { limit: PAGE_SIZE };
      if (cursor) params.cursor = cursor;
      let res = await services.wallets.list(params);
      if (!res?.data || (res.status === 304 && (!res.data || Object.keys(res.data).length === 0))) {
        res = await services.wallets.list(params, { headers: { 'Cache-Control': 'no-cache' } });
      }
      // normalize various response shapes: [] | { data: [] } | { wallets: [] }
      let walletList: any[] = [];
      if (Array.isArray(res.data)) walletList = res.data;
      else if (Array.isArray(res.data?.data)) walletList = res.data.data;
      else if (Array.isArray(res.data?.data?.items)) walletList = res.data.data.items;
      else if (Array.isArray(res.data?.data?.wallets)) walletList = res.data.data.wallets;
      else if (Array.isArray(res.data?.wallets)) walletList = res.data.wallets;
      else if (Array.isArray(res.data?.items)) walletList = res.data.items;
      else walletList = [];

      // normalize wallet objects (decimal shapes etc.)
      const normalized = walletList.map((w: any) => services.normalizeWallet(w));
      console.debug('[Wallets] fetched', { raw: res.data, count: walletList.length, normalizedCount: normalized.length });
      setWallets(normalized);

      // cursor pagination meta
      const hasMore = Boolean(res.data?.hasMore ?? res.data?.data?.hasMore ?? false);
      const nextCursor = res.data?.nextCursor ?? res.data?.data?.nextCursor ?? null;
      setHasMorePages(hasMore);
      setNextCursorValue(nextCursor ?? null);
      setCurrentCursor(cursor ?? null);
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets(null);
  }, []);

  const resolvedNextCursor = () => nextCursorValue;

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
      await services.wallets.create({
        name,
        accountNumber,
        // send initialBalance as string per API contract
        initialBalance: String(Number(initialBalance.replace(/\D/g, '')) || 0),
        startDate: new Date().toISOString()
      });
      setIsModalOpen(false);
      setName('');
      setAccountNumber('');
      setInitialBalance('');
      // reset pagination and refresh first page
      setCursorStack([]);
      setCurrentCursor(null);
      fetchWallets(null);
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
                disabled={cursorStack.length === 0 || isLoading}
                onClick={() => {
                  // go back: pop last cursor and refetch previous page
                  const prev = cursorStack.slice(0, -1);
                  setCursorStack(prev);
                  const lastCursor = prev.length > 0 ? prev[prev.length - 1] : null;
                  fetchWallets(lastCursor);
                }}
              >
                Previous
              </button>
              <span className="pagination-text">Cursor pagination</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={!hasMorePages || isLoading}
                onClick={() => {
                  const next = resolvedNextCursor();
                  if (!next) return;
                  // push current cursor onto stack so we can go back
                  setCursorStack(prev => [...prev, currentCursor]);
                  fetchWallets(next);
                }}
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
