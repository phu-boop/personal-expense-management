import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import './models/Wallet';
import './models/Transaction';
import './models/BalanceSnapshot';
import './models/ExportJob';

import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import transactionRoutes from './routes/transaction';
import statementRoutes from './routes/statement';
import exportRoutes from './routes/export';
import dashboardRoutes from './routes/dashboard';
import config from './config';

const app = express();
const port = Number(config.PORT);

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/wallets', transactionRoutes);
app.use('/api/wallets', statementRoutes);
app.use('/api/exports', exportRoutes);

const startServer = async () => {
  try {
    await mongoose.connect(config.MONGO_URI);
    console.log('Connected to MongoDB');

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to connect to MongoDB', error);
    process.exit(1);
  }
};

startServer();
