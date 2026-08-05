import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '../../utils';
import * as accountService from './account.service';
import type { AddressBody, AddressPatch, ProfilePatch } from './account.schema';

/** Only what the address book needs to show. */
function toPublicAddress(address: {
  _id: unknown; label?: string; name: string; phone: string;
  line1: string; line2?: string; city: string; state: string;
  pincode: string; country: string; isDefault: boolean;
}) {
  return {
    id: String(address._id),
    label: address.label,
    name: address.name,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    country: address.country,
    isDefault: address.isDefault,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await accountService.listAddresses(req.user!.id);
  sendSuccess(res, { addresses: addresses.map(toPublicAddress) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const address = await accountService.addAddress(req.user!.id, req.body as AddressBody);
  sendSuccess(res, { address: toPublicAddress(address) }, 'Address saved', 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const address = await accountService.updateAddress(
    req.user!.id,
    req.params.id,
    req.body as AddressPatch,
  );
  sendSuccess(res, { address: toPublicAddress(address) }, 'Address updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await accountService.removeAddress(req.user!.id, req.params.id);
  sendSuccess(res, null, 'Address removed');
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await accountService.updateProfile(req.user!.id, req.body as ProfilePatch);

  // A small shape, not the document: passwordHash, isBlocked and the rest have
  // no business crossing the wire.
  sendSuccess(
    res,
    { user: { id: String(user._id), name: user.name ?? null, phone: user.phone ?? null } },
    'Saved',
  );
});
