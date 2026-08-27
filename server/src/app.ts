import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRouter from './routes/auth.js';
import walletRouter from './routes/wallets.js';
import transactionRouter from './routes/transactions.js';
import reportRouter from './routes/reports.js';
import exportRouter from './routes/exports.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/ready', (_req, res) => {
  res.json({ ok: true, service: 'personal-expense-management-server' });
});

app.use('/api/auth', authRouter);
app.use('/api/wallets', walletRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api', reportRouter);
app.use('/api', exportRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
