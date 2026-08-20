import React from 'react';
import { Download } from 'lucide-react';
import './statement.css';

// Mock statement data
const mockStatement = {
  summary: {
    openingBalance: 12500000,
    totalIncome: 15000000,
    totalExpense: 6420000,
    closingBalance: 21080000
  },
  transactions: [
    { id: 1, type: 'INCOME', amount: 15000000, category: 'Salary', date: '20 Aug 2026', note: 'Salary August', balanceAfter: 21080000 },
    { id: 2, type: 'EXPENSE', amount: 50000, category: 'Food', date: '20 Aug 2026', note: 'Lunch', balanceAfter: 6080000 },
  ]
};

const Statement: React.FC = () => {
  return (
    <div className="statement-page">
      <header className="page-header">
        <div>
          <h1>Statement & Reports</h1>
          <p className="subtitle">View detailed financial statements and export data.</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary">
            <Download size={18} /> Export PDF
          </button>
          <button className="btn-secondary">
            <Download size={18} /> Export Excel
          </button>
        </div>
      </header>

      <div className="card filters-card glass-panel">
        <div className="filter-group">
          <label>Wallet</label>
          <select className="form-input"><option>All Wallets</option><option>Vietcombank</option></select>
        </div>
        <div className="filter-group">
          <label>From Date</label>
          <input type="date" className="form-input" defaultValue="2026-08-01" />
        </div>
        <div className="filter-group">
          <label>To Date</label>
          <input type="date" className="form-input" defaultValue="2026-08-31" />
        </div>
        <div className="filter-group button-group">
          <button className="btn-primary" style={{ height: '42px', marginTop: 'auto' }}>Generate</button>
        </div>
      </div>

      <div className="statement-summary-grid">
        <div className="summary-item">
          <div className="summary-label">Opening Balance</div>
          <div className="summary-value">{mockStatement.summary.openingBalance.toLocaleString('vi-VN')} ₫</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Income</div>
          <div className="summary-value income">+{mockStatement.summary.totalIncome.toLocaleString('vi-VN')} ₫</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Expense</div>
          <div className="summary-value expense">-{mockStatement.summary.totalExpense.toLocaleString('vi-VN')} ₫</div>
        </div>
        <div className="summary-item highlight">
          <div className="summary-label">Closing Balance</div>
          <div className="summary-value">{mockStatement.summary.closingBalance.toLocaleString('vi-VN')} ₫</div>
        </div>
      </div>

      <div className="card statement-table-card">
        <table className="statement-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="right-align">Income</th>
              <th className="right-align">Expense</th>
              <th className="right-align">Balance</th>
            </tr>
          </thead>
          <tbody>
            {mockStatement.transactions.map(tx => (
              <tr key={tx.id}>
                <td data-label="Date" className="tx-date-col">{tx.date}</td>
                <td data-label="Description">
                  <div className="tx-desc">{tx.note}</div>
                  <div className="tx-cat">{tx.category}</div>
                </td>
                <td data-label="Income" className="right-align income-col">
                  {tx.type === 'INCOME' ? `+${tx.amount.toLocaleString('vi-VN')} ₫` : '-'}
                </td>
                <td data-label="Expense" className="right-align expense-col">
                  {tx.type === 'EXPENSE' ? `-${tx.amount.toLocaleString('vi-VN')} ₫` : '-'}
                </td>
                <td data-label="Balance" className="right-align balance-col">
                  {tx.balanceAfter.toLocaleString('vi-VN')} ₫
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Statement;
