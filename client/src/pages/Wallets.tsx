import React, { useState } from 'react';
import { Plus, CreditCard } from 'lucide-react';
import './wallets.css';

// Mock data
const mockWallets = [
  { id: 1, name: 'Vietcombank', accountNumber: '**** 8921', balance: 18520000, lastUpdated: '2 hours ago' },
  { id: 2, name: 'Techcombank', accountNumber: '**** 1102', balance: 25000000, lastUpdated: '1 day ago' },
  { id: 3, name: 'Cash', accountNumber: 'Physical Cash', balance: 5000000, lastUpdated: 'Just now' },
];

const Wallets: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

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

      <div className="wallets-grid">
        {mockWallets.map(wallet => (
          <div key={wallet.id} className="card wallet-card glass-panel">
            <div className="wallet-icon">
              <CreditCard size={28} />
            </div>
            <div className="wallet-info">
              <h3>{wallet.name}</h3>
              <p className="account-number">{wallet.accountNumber}</p>
            </div>
            <div className="wallet-balance">
              <p className="balance-label">Current Balance</p>
              <h2>{wallet.balance.toLocaleString('vi-VN')} ₫</h2>
            </div>
            <div className="wallet-footer">
              Updated {wallet.lastUpdated}
            </div>
          </div>
        ))}
      </div>
      
      {/* Wallet creation modal placeholder */}
    </div>
  );
};

export default Wallets;
