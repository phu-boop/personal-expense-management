import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getDashboard } from '../services/dashboardService';

export const getDashboardOverview = async (req: AuthRequest, res: Response) => {
  try {
    const dashboard = await getDashboard({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
    });

    return res.json({ success: true, data: dashboard });
  } catch (error: any) {
    console.error('Dashboard fetch error:', error);
    return res.status(400).json({ success: false, message: error?.message || 'Failed to load dashboard' });
  }
};
