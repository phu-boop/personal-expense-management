import dotenv from 'dotenv';
import app from './app.js';
import { connectMongo } from './db/connect.js';
import { connectRedis } from './db/redis.js';

dotenv.config();

const port = Number(process.env.PORT || 5000);

const startServer = async () => {
  await connectMongo();
  await connectRedis();
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
