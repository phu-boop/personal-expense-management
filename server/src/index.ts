import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createClient } from 'redis';

import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import transactionRoutes from './routes/transaction';
import exportRoutes from './routes/export';
import { buildHealthStatus, isReadyForTraffic } from './services/healthCheck';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
}));

const serverState = {
  isShuttingDown: false,
  startedAt: Date.now(),
  redisConnected: false,
};

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (error) => {
  console.error('Redis connection error:', error);
  serverState.redisConnected = false;
});

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/exports', exportRoutes);

const buildCurrentStatus = () => buildHealthStatus({
  dbConnected: mongoose.connection.readyState === 1,
  redisConnected: serverState.redisConnected,
  uptimeMs: Date.now() - serverState.startedAt,
  timestamp: new Date().toISOString(),
});

app.get('/api/health', (req: Request, res: Response) => {
  const status = buildCurrentStatus();

  res.json({
    ...status,
    message: 'Server is running',
  });
});

app.get('/api/ready', (req: Request, res: Response) => {
  const status = buildCurrentStatus();

  if (!isReadyForTraffic(status)) {
    return res.status(503).json({
      ...status,
      message: 'Service is not ready for traffic',
    });
  }

  return res.json({
    ...status,
    message: 'Service ready',
  });
});

const startServer = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    try {
      await redisClient.connect();
      serverState.redisConnected = true;
      console.log('Connected to Redis');
    } catch (error) {
      console.warn('Redis unavailable; API will remain degraded until Redis is reachable', error);
      serverState.redisConnected = false;
    }

    const httpServer = app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });

    const shutdown = async () => {
      if (serverState.isShuttingDown) {
        return;
      }

      serverState.isShuttingDown = true;
      console.log('Graceful shutdown started');

      httpServer.close(async () => {
        await mongoose.disconnect();
        if (serverState.redisConnected) {
          await redisClient.quit();
        }
        console.log('MongoDB disconnected');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to connect to MongoDB', error);
    process.exit(1);
  }
};

startServer();
