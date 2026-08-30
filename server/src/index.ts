import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import './models/Wallet';
import './models/Transaction';
import './models/BalanceSnapshot';
import './models/ExportJob';

import authRoutes from './routes/auth';
import config from './config';

const app = express();
const port = Number(config.PORT);

app.use(express.json());
app.use('/api/auth', authRoutes);

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
