import React, { useState } from 'react';
import { Plus, Search, ArrowUpRight, ArrowDownRight, X } from 'lucide-react';
import './transactions.css';

// Mock data
const mockTransactions = [
  { id: 1, type: 'INCOME', amount: 15000000, category: 'Salary', wallet: 'Vietcombank', date: '20 Aug 2026', note: 'Salary August' },
  { id: 2, type: 'EXPENSE', amount: 50000, category: 'Food', wallet: 'Cash', date: '20 Aug 2026', note: 'Lunch with colleagues' },
  { id: 3, type: 'EXPENSE', amount: 350000, category: 'Shopping', wallet: 'Vietcombank', date: '18 Aug 2026', note: 'Groceries' },
];

const Transactions: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [txType, setTxType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');

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
            <input type="text" placeholder="Search transactions..." className="search-input" />
          </div>
          <div className="filters">
            <select className="filter-select"><option>All Wallets</option></select>
            <select className="filter-select"><option>All Categories</option></select>
          </div>
        </div>

        <div className="transaction-list">
          {mockTransactions.map((tx) => (
            <div key={tx.id} className="transaction-row">
              <div className={`tx-icon-wrapper ${tx.type.toLowerCase()}`}>
                {tx.type === 'INCOME' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
              </div>
              <div className="tx-details">
                <div className="tx-category">{tx.category}</div>
                <div className="tx-note">{tx.note} &bull; {tx.wallet}</div>
              </div>
              <div className="tx-meta">
                <div className={`tx-amount ${tx.type.toLowerCase()}`}>
                  {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('vi-VN')} ₫
                </div>
                <div className="tx-date">{tx.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in glass-panel">
            <div className="modal-header">
              <h2>Add Transaction</h2>
              <button className="icon-btn" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="type-toggle">
                <button 
                  className={`toggle-btn ${txType === 'INCOME' ? 'active income' : ''}`}
                  onClick={() => setTxType('INCOME')}
                >
                  Income
                </button>
                <button 
                  className={`toggle-btn ${txType === 'EXPENSE' ? 'active expense' : ''}`}
                  onClick={() => setTxType('EXPENSE')}
                >
                  Expense
                </button>
              </div>

              <div className="form-group">
                <label>Amount (₫)</label>
                <input type="number" placeholder="0" className={`form-input amount-input ${txType.toLowerCase()}`} autoFocus />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Wallet</label>
                  <select className="form-input">
                    <option>Vietcombank</option>
                    <option>Cash</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="form-input">
                    <option>Food</option>
                    <option>Salary</option>
                    <option>Shopping</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Date</label>
                <input type="date" className="form-input" defaultValue={new Date().toISOString().split('T')[0]} />
              </div>

              <div className="form-group">
                <label>Note (Optional)</label>
                <input type="text" placeholder="What was this for?" className="form-input" />
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className={`btn-primary ${txType.toLowerCase()}-btn`}>
                Add {txType === 'INCOME' ? 'Income' : 'Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transactions;
