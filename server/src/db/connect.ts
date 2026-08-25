import mongoose from 'mongoose';

export const connectMongo = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';

  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  }
};
