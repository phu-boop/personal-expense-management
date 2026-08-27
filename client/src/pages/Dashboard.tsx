import React, { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight, CreditCard, Sparkles, Plus, Eye, EyeOff, BarChart3, ListFilter, Zap, Folder } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/api';
import './dashboard.css';

const COLORS = ['#14A800', '#3b82f6', '#6366f1', '#8b5cf6', '#64748b', '#94a3b8'];

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-chart-tooltip">
        <p className="tooltip-title">{label}</p>
        <div className="tooltip-row income">
          <span>Income:</span>
          <strong>+{payload[0]?.value?.toLocaleString('vi-VN')} VND</strong>
        </div>
        <div className="tooltip-row expense">
          <span>Expense:</span>
          <strong>-{payload[1]?.value?.toLocaleString('vi-VN')} VND</strong>
        </div>
      </div>
    );
  }
  return null;
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    return (
      <div className="custom-chart-tooltip">
        <p className="tooltip-title" style={{ color: data.payload.fill || '#6366f1' }}>{data.name}</p>
        <div className="tooltip-row">
          <span>Total Spent:</span>
          <strong>{data.value?.toLocaleString('vi-VN')} VND</strong>
        </div>
      </div>
    );
  }
  return null;
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [totalBalance, setTotalBalance] = useState(0);
  const [wallets, setWallets] = useState<any[]>([]);
  const [activeWallets, setActiveWallets] = useState(0);
  const [income, setIncome] = useState(0);
  const [expense, setExpense] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  const [showTotalBalance, setShowTotalBalance] = useState(false);
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);
  const [walletVisibility, setWalletVisibility] = useState<Record<string, boolean>>({});

  const [monthlyChart, setMonthlyChart] = useState<any[]>([]);
  const [categoryChart, setCategoryChart] = useState<any[]>([]);
  const [insightMessage, setInsightMessage] = useState('');

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target as Node)) {
        setShowWalletDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setIsLoading(true);
      try {
        const [walletsRes, txRes, insightsRes] = await Promise.all([
          api.get('/api/wallets'),
          api.get('/api/transactions?limit=5'),
          api.get('/api/transactions/insights')
        ]);

        const walletsPayload = walletsRes.data?.data ?? walletsRes.data ?? [];
        const walletsData = Array.isArray(walletsPayload) ? walletsPayload : [];
        setWallets(walletsData);
        setActiveWallets(walletsData.length);
        setTotalBalance(walletsData.reduce((acc: number, w: any) => acc + w.currentBalance, 0));
        const visMap: Record<string, boolean> = {};
        walletsData.forEach((w: any) => { visMap[w._id] = true; });
        setWalletVisibility(visMap);

        const txPayload = txRes.data?.data ?? txRes.data ?? [];
        setRecentTransactions(Array.isArray(txPayload) ? txPayload : []);

        const insightPayload = insightsRes.data?.data ?? insightsRes.data ?? {};
        const {
          income: insightIncome = 0,
          expense: insightExpense = 0,
          walletTotal,
          monthlyChart = [],
          categoryChart = [],
          insightMessage = '',
        } = insightPayload as any;

        setMonthlyChart(Array.isArray(monthlyChart) ? monthlyChart : []);
        setCategoryChart(Array.isArray(categoryChart) ? categoryChart : []);
        setInsightMessage(typeof insightMessage === 'string' ? insightMessage : '');

        const currentMonthData = (Array.isArray(monthlyChart) ? monthlyChart : []).length > 0
          ? monthlyChart[monthlyChart.length - 1]
          : { Income: Number(insightIncome) || 0, Expense: Number(insightExpense) || 0 };

        const nextIncome = Number(currentMonthData?.Income ?? insightIncome) || 0;
        const nextExpense = Number(currentMonthData?.Expense ?? insightExpense) || 0;

        setIncome(nextIncome);
        setExpense(nextExpense);

        if (typeof walletTotal === 'number' && Number.isFinite(walletTotal)) {
          setTotalBalance(walletTotal);
        }

      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const savingsRate = income > 0 ? Math.max(0, Math.round(((income - expense) / income) * 100)) : 0;
  const healthScore = Math.min(98, Math.max(62, 70 + Math.round(savingsRate / 2)));
  const healthStatus = savingsRate >= 30 ? '🚀 Excellent' : savingsRate >= 10 ? '⚡ Good' : '💡 On Track';

  return (
    <div className="dashboard">
      <header className="page-header animate-fade-in">
        <div>
          <h1>Good {new Date().getHours() < 12 ? 'morning' : 'evening'}, {user?.name?.split(' ')[0] || 'User'} 👋</h1>
          <p className="subtitle">Here's your financial overview.</p>
        </div>
        <button className="fab-btn" onClick={() => navigate('/transactions?action=new')} title="Add Transaction">
          <Plus size={20} />
        </button>
      </header>

      {isLoading ? (
        <div style={{ padding: '2rem' }}>Loading your dashboard...</div>
      ) : (
        <>
          <div className="metrics-cards-grid animate-fade-in">
            <div className="card metric-card main-balance">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="metric-label">TOTAL BALANCE</div>
                <button
                  type="button"
                  className="eye-toggle-btn"
                  onClick={() => setShowTotalBalance(!showTotalBalance)}
                  title={showTotalBalance ? "Hide Balance" : "Show Balance"}
                >
                  {showTotalBalance ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
              <div className="metric-value">
                {showTotalBalance ? `${totalBalance.toLocaleString('vi-VN')} VND` : '•••••••• VND'}
              </div>
              <div
                ref={walletMenuRef}
                className={`metric-footer has-dropdown ${showWalletDropdown ? 'open' : ''}`}
                onClick={() => setShowWalletDropdown((prev) => !prev)}
              >
                <span>Across {activeWallets} active wallets <span className="caret">▼</span></span>
                {showWalletDropdown && (
                  <div className="wallets-dropdown animate-fade-in">
                    <div className="dropdown-title">Your Balances & Quick Actions</div>
                    {wallets.map(w => (
                      <div key={w._id} className="dropdown-wallet-item">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{w.name}</span>
                            <button
                              type="button"
                              className="eye-toggle-btn"
                              title={walletVisibility[w._id] ? 'Hide this wallet balance' : 'Show this wallet balance'}
                              onClick={(e) => { e.stopPropagation(); setWalletVisibility((prev) => ({ ...prev, [w._id]: !prev[w._id] })); }}
                              style={{ background: 'transparent', border: 'none', padding: 0, marginLeft: 6 }}
                            >
                              {walletVisibility[w._id] ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                          </div>
                          <strong>
                            {walletVisibility[w._id] ? `${w.currentBalance.toLocaleString('vi-VN')} VND` : '•••••••• VND'}
                          </strong>
                        </div>
                        <div className="dropdown-wallet-actions" style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="wallet-action-btn"
                            title="View report for this wallet"
                            onClick={(e) => { e.stopPropagation(); navigate(`/statement?walletId=${w._id}`); }}
                          >
                            <BarChart3 size={14} />
                          </button>
                          <button
                            className="wallet-action-btn"
                            title="View transaction history"
                            onClick={(e) => { e.stopPropagation(); navigate(`/transactions?walletId=${w._id}`); }}
                          >
                            <ListFilter size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <Link to="/wallets" className="dropdown-manage-link" onClick={() => setShowWalletDropdown(false)}>Manage Wallets</Link>
                  </div>
                )}
              </div>
            </div>

            <div
              className="card metric-card income-card clickable-card"
              onClick={() => navigate('/transactions')}
              title="View all transactions"
              style={{ cursor: 'pointer' }}
            >
              <div className="metric-card-header">
                <div className="metric-icon income"><ArrowUpRight size={22} /></div>
                <span className="metric-tag income-tag">Inflow</span>
              </div>
              <div className="metric-label">INCOME (This month)</div>
              <div className="metric-value small income-val">+{income.toLocaleString('vi-VN')} VND</div>
              <div className="metric-subnote">Total received this month</div>
            </div>

            <div
              className="card metric-card expense-card clickable-card"
              onClick={() => navigate('/transactions')}
              title="View all transactions"
              style={{ cursor: 'pointer' }}
            >
              <div className="metric-card-header">
                <div className="metric-icon expense"><ArrowDownRight size={22} /></div>
                <span className="metric-tag expense-tag">Outflow</span>
              </div>
              <div className="metric-label">EXPENSE (This month)</div>
              <div className="metric-value small expense-val">-{expense.toLocaleString('vi-VN')} VND</div>
              <div className="metric-subnote">Total spent this month</div>
            </div>

            <div
              className="card metric-card neutral-card clickable-card"
              onClick={() => navigate('/wallets')}
              title="Manage wallets"
              style={{ cursor: 'pointer' }}
            >
              <div className="metric-card-header">
                <div className="metric-icon neutral"><CreditCard size={22} /></div>
                <span className="metric-tag neutral-tag">Active</span>
              </div>
              <div className="metric-label">ACTIVE WALLETS</div>
              <div className="metric-value small">{activeWallets} Wallets</div>
              <div className="metric-subnote">Ready for transactions</div>
            </div>
          </div>

          {insightMessage && (
            <div className="insight-banner animate-fade-in">
              <Sparkles size={20} color="var(--primary)" />
              <p><strong>Smart Insight:</strong> {insightMessage}</p>
            </div>
          )}

          <div className="charts-grid animate-fade-in">
            <div className="card chart-card glass-panel">
              <div className="chart-header">
                <h2>Cash Flow (6 Months)</h2>
                <div className="chart-legend-badge">
                  <span><span className="legend-dot income"></span>Income</span>
                  <span><span className="legend-dot expense"></span>Expense</span>
                </div>
              </div>
              <div className="chart-container">
                {monthlyChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'transparent' }} />
                      <Bar dataKey="Income" fill="#14A800" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty-state">
                    <div className="chart-empty-icon">
                      <Folder size={24} />
                    </div>
                    <strong>No data available</strong>
                    <span>Add your first income or expense to unlock the 6-month cash flow chart.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="card chart-card glass-panel">
              <div className="chart-header">
                <h2>Expense Breakdown</h2>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Current Month</span>
              </div>
              <div className="chart-container">
                {categoryChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryChart}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="#ffffff"
                        strokeWidth={3}
                      >
                        {categoryChart.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomPieTooltip />} />
                      <Legend
                        layout="horizontal"
                        verticalAlign="bottom"
                        align="center"
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty-state compact">
                    <div className="chart-empty-icon">
                      <Folder size={22} />
                    </div>
                    <strong>No expenses this month</strong>
                    <span>Your spending breakdown will appear here once you add transactions.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="dashboard-bottom-grid animate-fade-in" style={{ marginTop: 'var(--space-6)' }}>
            <div className="card recent-transactions glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Recent Transactions</h2>
                <Link to="/transactions" style={{ fontSize: '14px', color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>View All</Link>
              </div>

              {recentTransactions.length === 0 ? (
                <div className="recent-empty-state">
                  <div className="recent-empty-icon">
                    <Folder size={28} />
                  </div>
                  <strong>No transactions yet.</strong>
                  <span>Your latest income and expense entries will appear here.</span>
                  <button className="btn-primary" onClick={() => navigate('/transactions?action=new')}>Add Transaction</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {recentTransactions.map(tx => (
                    <div
                      key={tx._id}
                      className="transaction-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/transactions?walletId=${tx.walletId?._id}`)}
                      title="Click to view transactions for this wallet"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className={`tx-icon-wrapper ${tx.type.toLowerCase()}`} style={{ margin: 0, width: 40, height: 40 }}>
                          {tx.type === 'INCOME' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tx.category}</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(tx.date).toLocaleDateString()} &bull; {tx.walletId?.name}</div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, color: tx.type === 'INCOME' ? 'var(--primary)' : 'var(--text-primary)' }}>
                        {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('vi-VN')} VND
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card health-widget-card glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h2>Financial Health</h2>
                <span className="health-badge">{healthStatus}</span>
              </div>

              <div className="health-score-box">
                <div className="score-circle">
                  <span className="score-value">{healthScore}</span>
                  <span className="score-max">/100</span>
                </div>
                <div className="score-details">
                  <h4>FinaScore Index</h4>
                  <p>Smart rating based on income, spendings & savings habits.</p>
                </div>
              </div>

              <div className="savings-progress-section" style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Monthly Savings Rate</span>
                  <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{savingsRate}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(6, savingsRate))}%` }}></div>
                </div>
              </div>

              <div className="pro-tip-box" style={{ marginTop: '1.5rem' }}>
                <Zap size={20} color="#f59e0b" style={{ flexShrink: 0 }} />
                <p>
                  {savingsRate > 20
                    ? `Great job! You saved ${savingsRate}% of your total income this month. Keep it up!`
                    : `Try allocating at least 20% of income to your savings wallets.`}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
