import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import * as dashboardController from './dashboard.controller';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/stats', dashboardController.stats);
router.get('/recent-orders', dashboardController.recentOrders);

export default router;
