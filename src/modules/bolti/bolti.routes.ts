import { Router } from 'express';

import { requireAuth, requireRole } from '../../middleware/auth';
import { revealLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as boltiController from './bolti.controller';
import {
  bulkQrSchema,
  idParamSchema,
  listBoltiQuerySchema,
  qrQuerySchema,
  tokenParamSchema,
} from './bolti.schema';

/** Admin side — everything behind auth. */
export const boltiRoutes = Router();

boltiRoutes.use(requireAuth, requireRole('admin'));

boltiRoutes.get('/', validate({ query: listBoltiQuerySchema }), boltiController.list);

// Before `/:id`. Express takes the first match, so with the order reversed
// "bulk-qr" is read as an id and Mongo throws a CastError.
boltiRoutes.post('/bulk-qr', validate({ body: bulkQrSchema }), boltiController.bulkQr);

boltiRoutes.get('/:id', validate({ params: idParamSchema }), boltiController.getById);
boltiRoutes.get(
  '/:id/qr',
  validate({ params: idParamSchema, query: qrQuerySchema }),
  boltiController.qr,
);

/**
 * Public side — the brother scans a QR and lands here with no account.
 *
 * Mounted separately from the admin router precisely so it stays outside
 * requireAuth, with its own limiter: the token is the only secret, and this
 * endpoint is the one place someone could guess at it.
 */
export const revealRoutes = Router();

revealRoutes.get(
  '/:token',
  revealLimiter,
  validate({ params: tokenParamSchema }),
  boltiController.reveal,
);
