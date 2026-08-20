import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, WalletCards, ArrowRightLeft, FileBarChart, Settings } from 'lucide-react';

const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <NavLink to="/" className="sidebar-logo">
          <WalletCards size={24} />
          <span>FinaVault</span>
        </NavLink>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} end>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/transactions" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <ArrowRightLeft size={20} />
          <span>Transactions</span>
        </NavLink>
        <NavLink to="/wallets" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <WalletCards size={20} />
          <span>Wallets</span>
        </NavLink>
        <NavLink to="/statement" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <FileBarChart size={20} />
          <span>Statement</span>
        </NavLink>
      </nav>

      <div className="sidebar-nav" style={{ flex: 'none', paddingBottom: '24px' }}>
        <a href="#" className="nav-item">
          <Settings size={20} />
          <span>Settings</span>
        </a>
      </div>
    </aside>
  );
};

export default Sidebar;
