import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';
import services from '../../api/services';
import { useExportQueue } from '../../contexts/ExportQueueContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatMoney } from '../../utils/formatMoney';
import './layout.css';

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [hasCheckedWallets, setHasCheckedWallets] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const hasCheckedWalletsRef = useRef(false);

  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { exportQueue } = useExportQueue();

  const checkWallets = async () => {
    if (hasCheckedWalletsRef.current) return;
    hasCheckedWalletsRef.current = true;

    try {
      const res = await services.wallets.compact();
      const walletList = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.items)
          ? res.data.items
          : Array.isArray(res.data?.data)
            ? res.data.data
            : [];

      setShowOnboarding(walletList.length === 0);
    } catch (err) {
      console.error('Failed to check wallets:', err);
      setShowOnboarding(false);
    } finally {
      setHasCheckedWallets(true);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setShowOnboarding(false);
      setHasCheckedWallets(true);
      return;
    }

    checkWallets();
  }, [isAuthenticated]);

  const handleInitialBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setInitialBalance('');
      return;
    }

    setInitialBalance(formatMoney(Number(rawDigits)));
  };

  const handleCreateFirstWallet = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await services.wallets.create({
        name,
        accountNumber,
        initialBalance: Number(initialBalance.replace(/\D/g, '')) || 0,
        startDate: new Date().toISOString()
      });
      setShowOnboarding(false);
      window.location.reload();
    } catch (err: any) {
      console.error('Failed to create first wallet:', err);
      setError(err.response?.data?.message || 'Failed to create wallet. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Header />
        <main className="page-container animate-fade-in">
          <Outlet />
        </main>
      </div>
      <BottomNav />

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

      {hasCheckedWallets && showOnboarding && ReactDOM.createPortal(
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal-content animate-fade-in glass-panel" style={{ maxWidth: '550px', pointerEvents: 'auto' }}>
            <div className="modal-header" style={{ marginBottom: '1rem' }}>
              <div>
                <h2>Welcome to Expense Manager!👋</h2>
                <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Please create your first wallet (e.g. Cash, Bank Account) to start tracking your finances.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateFirstWallet} className="modal-body">
              {error && <div style={{ color: 'var(--expense)', marginBottom: '1rem', fontSize: '14px' }}>{error}</div>}

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Wallet Name (e.g. Vietcombank, Cash)
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. Cash, Vietcombank"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Account Number (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 1029384756"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Initial Balance (VND)
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="0"
                  value={initialBalance}
                  onChange={handleInitialBalanceChange}
                />
              </div>

              <div className="modal-footer">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                  style={{ width: '100%', height: '44px', justifyContent: 'center' }}
                >
                  {isSubmitting ? 'Creating Wallet...' : 'Create First Wallet & Get Started'}
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

export default AppLayout;
