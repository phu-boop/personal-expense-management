import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../api/api';
import CustomSelect from '../components/CustomSelect';
import CustomDatePicker from '../components/CustomDatePicker';
import './statement.css';

interface Summary {
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
}

interface Transaction {
  _id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  date: string;
  note?: string;
  balanceAfter: number;
}

interface Wallet {
  _id: string;
  name: string;
}

const Statement: React.FC = () => {
  const [summary, setSummary] = useState<Summary>({
    openingBalance: 0,
    totalIncome: 0,
    totalExpense: 0,
    closingBalance: 0
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const initialWalletId = searchParams.get('walletId') || '';

  // Filters
  const [walletId, setWalletId] = useState(initialWalletId);

  // Default to current month
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);

  useEffect(() => {
    // Fetch wallets for the filter dropdown
    api.get('/api/wallets').then(res => setWallets(res.data)).catch(console.error);
  }, []);

  const fetchStatement = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (walletId) params.append('walletId', walletId);

      const res = await api.get(`/api/transactions/statement?${params.toString()}`);
      setSummary(res.data.summary);
      setTransactions(res.data.transactions);
    } catch (error) {
      console.error('Failed to fetch statement:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const paramWalletId = searchParams.get('walletId');
    if (paramWalletId) {
      setWalletId(paramWalletId);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]); // Fetch when walletId or initial load changes

  const handleGenerate = () => {
    fetchStatement();
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(transactions.map(tx => ({
      Date: new Date(tx.date).toLocaleDateString(),
      Category: tx.category,
      Description: tx.note || '',
      Type: tx.type,
      Amount: tx.amount,
      Balance: tx.balanceAfter
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
    saveAs(data, `statement_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="statement-page">
      <header className="page-header">
        <div>
          <h1>Statement & Reports</h1>
          <p className="subtitle">View detailed financial statements and export data.</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={exportExcel}>
            <Download size={18} /> Export Excel
          </button>
        </div>
      </header>

      <div className="card filters-card glass-panel animate-fade-in">
        <div className="filter-group">
          <label>Wallet</label>
          <CustomSelect
            value={walletId}
            onChange={setWalletId}
            options={[{ value: '', label: 'All Wallets' }, ...wallets.map(w => ({ value: w._id, label: w.name }))]}
            placeholder="All Wallets"
          />
        </div>
        <div className="filter-group">
          <label>From Date</label>
          <CustomDatePicker value={startDate} onChange={setStartDate} placeholder="From Date" />
        </div>
        <div className="filter-group">
          <label>To Date</label>
          <CustomDatePicker value={endDate} onChange={setEndDate} placeholder="To Date" />
        </div>
        <div className="filter-group button-group">
          <button className="btn-primary" onClick={handleGenerate}>
            Generate
          </button>
        </div>
      </div>

      <div className="statement-summary-grid animate-fade-in">
        <div className="summary-item">
          <div className="summary-label">Opening Balance</div>
          <div className="summary-value">{summary.openingBalance.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Income</div>
          <div className="summary-value income">+{summary.totalIncome.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total Expense</div>
          <div className="summary-value expense">-{summary.totalExpense.toLocaleString('vi-VN')} VND</div>
        </div>
        <div className="summary-item highlight">
          <div className="summary-label">Closing Balance</div>
          <div className="summary-value">{summary.closingBalance.toLocaleString('vi-VN')} VND</div>
        </div>
      </div>

      <div className="card statement-table-card animate-fade-in">
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading statement...</div>
        ) : transactions.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No transactions found for this period.</div>
        ) : (
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
              {transactions.map(tx => (
                <tr key={tx._id}>
                  <td data-label="Date" className="tx-date-col">{new Date(tx.date).toLocaleDateString()}</td>
                  <td data-label="Description">
                    <div className="tx-desc">{tx.note || tx.category}</div>
                    <div className="tx-cat">{tx.category}</div>
                  </td>
                  <td data-label="Income" className="right-align income-col">
                    {tx.type === 'INCOME' ? `+${tx.amount.toLocaleString('vi-VN')} VND` : '-'}
                  </td>
                  <td data-label="Expense" className="right-align expense-col">
                    {tx.type === 'EXPENSE' ? `-${tx.amount.toLocaleString('vi-VN')} VND` : '-'}
                  </td>
                  <td data-label="Balance" className="right-align balance-col">
                    {tx.balanceAfter.toLocaleString('vi-VN')} VND
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Statement;
