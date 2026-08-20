import React from 'react';
import { Bell } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <Bell size={20} />
        </button>
        <div className="user-profile">
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Phú</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Premium</div>
          </div>
          <div className="avatar">P</div>
        </div>
      </div>
    </header>
  );
};

export default Header;
