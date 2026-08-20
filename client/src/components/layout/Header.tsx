import React from 'react';
import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const Header: React.FC = () => {
  const { user, logout } = useAuth();
  
  const firstName = user?.name?.split(' ')[0] || 'User';
  const initial = firstName.charAt(0).toUpperCase();

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <Bell size={20} />
        </button>
        <div className="user-profile">
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{user?.name || 'User'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Premium</div>
          </div>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="Avatar" className="avatar" style={{ objectFit: 'cover' }} />
          ) : (
            <div className="avatar">{initial}</div>
          )}
        </div>
        <button 
          onClick={logout}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--expense)', display: 'flex', alignItems: 'center' }}
          title="Logout"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
};

export default Header;
