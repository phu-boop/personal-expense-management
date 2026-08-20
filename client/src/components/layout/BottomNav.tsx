import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, WalletCards, ArrowRightLeft, FileBarChart } from 'lucide-react';

const BottomNav: React.FC = () => {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`} end>
        <LayoutDashboard size={20} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/transactions" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <ArrowRightLeft size={20} />
        <span>Trans</span>
      </NavLink>
      <NavLink to="/wallets" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <WalletCards size={20} />
        <span>Wallets</span>
      </NavLink>
      <NavLink to="/statement" className={({isActive}) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <FileBarChart size={20} />
        <span>Reports</span>
      </NavLink>
    </nav>
  );
};

export default BottomNav;
