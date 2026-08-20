import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/api';
import './dashboard.css';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  
  const [totalBalance, setTotalBalance] = useState(0);
  const [activeWallets, setActiveWallets] = useState(0);
  const [income, setIncome] = useState(0);
  const [expense, setExpense] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setIsLoading(true);
      try {
        // 1. Fetch Wallets for Total Balance and Count
        const walletsRes = await api.get('/api/wallets');
        const wallets = walletsRes.data;
        setActiveWallets(wallets.length);
        const balance = wallets.reduce((acc: number, w: any) => acc + w.currentBalance, 0);
        setTotalBalance(balance);

        // 2. Fetch Statement for this month's Income & Expense
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const statementRes = await api.get(`/api/transactions/statement?startDate=${startDate}&endDate=${endDate}`);
        setIncome(statementRes.data.summary.totalIncome);
        setExpense(statementRes.data.summary.totalExpense);

        // 3. Fetch Recent Transactions
        const txRes = await api.get('/api/transactions?limit=5');
        setRecentTransactions(txRes.data.data);

      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header animate-fade-in">
        <h1>Good {new Date().getHours() < 12 ? 'morning' : 'evening'}, {user?.name?.split(' ')[0] || 'User'} 👋</h1>
        <p className="subtitle">Here's your financial overview for this month.</p>
      </header>

      {isLoading ? (
        <div style={{ padding: '2rem' }}>Loading your dashboard...</div>
      ) : (
        <>
          <div className="metrics-grid animate-fade-in">
            <div className="card glass-panel metric-card main-balance">
              <div className="metric-label">TOTAL BALANCE</div>
              <div className="metric-value">{totalBalance.toLocaleString('vi-VN')} ₫</div>
              <div className="metric-footer">
                Across {activeWallets} active wallets
              </div>
            </div>

            <div className="card metric-card">
              <div className="metric-icon income">
                <ArrowUpRight size={24} />
              </div>
              <div className="metric-label">INCOME (This month)</div>
              <div className="metric-value small">+{income.toLocaleString('vi-VN')} ₫</div>
            </div>

            <div className="card metric-card">
              <div className="metric-icon expense">
                <ArrowDownRight size={24} />
              </div>
              <div className="metric-label">EXPENSE (This month)</div>
              <div className="metric-value small">-{expense.toLocaleString('vi-VN')} ₫</div>
            </div>

            <div className="card metric-card">
              <div className="metric-icon neutral">
                <CreditCard size={24} />
              </div>
              <div className="metric-label">ACTIVE WALLETS</div>
              <div className="metric-value small">{activeWallets}</div>
            </div>
          </div>

          <div className="dashboard-content animate-fade-in">
            <div className="card recent-transactions">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Recent Transactions</h2>
                <Link to="/transactions" style={{ fontSize: '14px', color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>View All</Link>
              </div>
              
              {recentTransactions.length === 0 ? (
                <div className="empty-state">
                  <p>No transactions yet.</p>
                  <Link to="/transactions" className="btn-primary" style={{ textDecoration: 'none' }}>Add Transaction</Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {recentTransactions.map(tx => (
                    <div key={tx._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className={`tx-icon-wrapper ${tx.type.toLowerCase()}`} style={{ margin: 0, width: 36, height: 36 }}>
                          {tx.type === 'INCOME' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tx.category}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(tx.date).toLocaleDateString()} &bull; {tx.walletId?.name}</div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, color: tx.type === 'INCOME' ? 'var(--primary)' : 'var(--text-primary)' }}>
                        {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('vi-VN')} ₫
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
