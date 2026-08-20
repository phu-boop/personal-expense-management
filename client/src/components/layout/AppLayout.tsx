import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';
import api from '../../api/api';
import './layout.css';

const AppLayout: React.FC = () => {
  const [hasCheckedWallets, setHasCheckedWallets] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Onboarding Form State
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const checkWallets = async () => {
    try {
      const res = await api.get('/api/wallets');
      if (res.data && res.data.length === 0) {
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }
    } catch (err) {
      console.error('Failed to check wallets:', err);
    } finally {
      setHasCheckedWallets(true);
    }
  };

  useEffect(() => {
    checkWallets();
  }, []);

  const handleCreateFirstWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await api.post('/api/wallets', {
        name,
        accountNumber,
        initialBalance: Number(initialBalance) || 0,
        startDate: new Date().toISOString()
      });
      setShowOnboarding(false);
      // Reload current page to refresh wallet state across dashboard & pages
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

      {/* Mandatory First-Wallet Onboarding Modal */}
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
                  type="number"
                  className="form-input"
                  required
                  placeholder="0"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
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
