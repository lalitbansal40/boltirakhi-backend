import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { deleteSchema, presignSchema, readUrlSchema } from './upload.schema';
import * as uploadController from './upload.controller';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.post('/presign', validate({ body: presignSchema }), uploadController.presign);
router.post('/read-url', validate({ body: readUrlSchema }), uploadController.readUrl);
router.delete('/', validate({ body: deleteSchema }), uploadController.remove);

export default router;
