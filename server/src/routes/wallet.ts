import express, { Response } from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import Wallet from '../models/Wallet';

const router = express.Router();
router.use(authenticate);

// Create a new wallet
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, accountNumber, initialBalance, startDate } = req.body;
    
    if (!name || initialBalance === undefined || !startDate) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const wallet = new Wallet({
      userId: req.user!.id,
      name,
      accountNumber,
      initialBalance,
      currentBalance: initialBalance,
      startDate: new Date(startDate),
    });

    await wallet.save();
    res.status(201).json(wallet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all wallets for the user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const wallets = await Wallet.find({ userId: req.user!.id }).sort({ createdAt: -1 });
    res.json(wallets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
