import React from 'react';
import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const Header: React.FC = () => {
  const { user, logout } = useAuth();

  const firstName = user?.name?.split(' ')[0] || 'User';
  const initial = firstName.charAt(0).toUpperCase();

  return (
    <header className="header">
      <div className="user-profile">
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="Avatar" className="avatar" style={{ objectFit: 'cover' }} />
        ) : (
          <div className="avatar">{initial}</div>
        )}
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name || 'User'}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Premium Member</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="header-icon-btn" title="Notifications">
          <Bell size={18} />
        </button>
        <button
          onClick={logout}
          className="logout-btn"
          title="Logout"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
};

export default Header;
