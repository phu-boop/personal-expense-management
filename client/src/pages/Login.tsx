import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import type { CredentialResponse } from '@react-oauth/google';
import { WalletCards } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/api';
import './login.css';

const Login: React.FC = () => {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    setIsLoading(true);
    setError(null);
    try {
      // Send the Google JWT token to our backend to verify and create/login the user
      const response = await api.post('/api/auth/google', {
        token: credentialResponse.credential
      });
      
      const { token, user } = response.data;
      
      // Store in context (which will also redirect or update state)
      login(token, user);
      
      // Redirect to home
      window.location.href = '/';
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to authenticate with server. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google Login failed. Please try again.');
  };

  return (
    <div className="login-page">
      <div className="login-container glass-panel animate-fade-in">
        <div className="login-header">
          <div className="login-logo">
            <WalletCards size={36} color="var(--primary)" />
          </div>
          <h1>Welcome to FinaVault</h1>
          <p>Track your expenses seamlessly and secure your financial future.</p>
        </div>
        
        <div className="login-body">
          {error && <div className="login-error">{error}</div>}
          
          <div className="google-auth-wrapper">
            {isLoading ? (
              <div className="loading-spinner">Authenticating...</div>
            ) : (
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                shape="rectangular"
                theme="outline"
                size="large"
                text="continue_with"
                width={300}
              />
            )}
          </div>
        </div>
        
        <div className="login-footer">
          <p>By continuing, you agree to our Terms of Service and Privacy Policy.</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
