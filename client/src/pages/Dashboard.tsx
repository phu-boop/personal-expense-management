import React from 'react';
import { ArrowUpRight, ArrowDownRight, CreditCard } from 'lucide-react';
import './dashboard.css';

const Dashboard: React.FC = () => {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Good evening, Phú 👋</h1>
        <p className="subtitle">Here's your financial overview.</p>
      </header>

      <div className="metrics-grid">
        <div className="card glass-panel metric-card main-balance">
          <div className="metric-label">TOTAL BALANCE</div>
          <div className="metric-value">48,520,000 ₫</div>
          <div className="metric-footer">
            <span className="trend positive">+8.2% ↑</span> from last month
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-icon income">
            <ArrowUpRight size={24} />
          </div>
          <div className="metric-label">INCOME (This month)</div>
          <div className="metric-value small">+15,000,000 ₫</div>
        </div>

        <div className="card metric-card">
          <div className="metric-icon expense">
            <ArrowDownRight size={24} />
          </div>
          <div className="metric-label">EXPENSE (This month)</div>
          <div className="metric-value small">-6,420,000 ₫</div>
        </div>

        <div className="card metric-card">
          <div className="metric-icon neutral">
            <CreditCard size={24} />
          </div>
          <div className="metric-label">ACTIVE WALLETS</div>
          <div className="metric-value small">3</div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="card recent-transactions">
          <h2>Recent Transactions</h2>
          <div className="empty-state">
            <p>No transactions yet.</p>
            <button className="btn-primary">Add Transaction</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
