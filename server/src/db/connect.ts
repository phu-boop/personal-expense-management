import mongoose from 'mongoose';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const connectMongo = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('MongoDB connected successfully');
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.error(`MongoDB connection failed (attempt ${attempt}/${maxAttempts}):`, error);
      if (isLastAttempt) {
        throw error;
      }
      await wait(2000);
    }
  }
};
