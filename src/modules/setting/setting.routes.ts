import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { updateSettingSchema } from './setting.schema';
import * as settingController from './setting.controller';

const router = Router();

// Mounted once for the whole router. Per-route guards are how one route ends
// up unprotected.
router.use(requireAuth, requireRole('admin'));

// A singleton — no :id anywhere.
router.get('/', settingController.get);
router.patch('/', validate({ body: updateSettingSchema }), settingController.update);

export { router as settingRoutes };
