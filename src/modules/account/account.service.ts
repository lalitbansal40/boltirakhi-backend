import { Types } from 'mongoose';

import { User, type IAddress, type IUser } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import type { AddressBody, AddressPatch } from './account.schema';

/**
 * A customer's saved addresses.
 *
 * Every function here starts from the signed-in user and works down into their
 * own `addresses` array. None of them ever looks an address up by its id alone.
 *
 * That is the whole security model of this file: an address id is a plain
 * ObjectId sitting in a URL, and a route that fetched by id and then checked
 * ownership afterwards would be one forgotten `if` away from letting anyone
 * read or delete anyone else's address.
 */

/** Beyond this a list stops being useful to scroll and starts being a place to dump data. */
const MAX_ADDRESSES = 10;

async function loadUser(userId: string): Promise<IUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  return user;
}

/**
 * Find one of *this user's* addresses.
 *
 * A miss is a 404 rather than a 403: telling someone their guess pointed at a
 * real address belonging to somebody else is itself information.
 */
function findOwn(user: IUser, addressId: string): IAddress {
  const address = user.addresses.id(new Types.ObjectId(addressId));
  if (!address) throw ApiError.notFound('Address not found');
  return address as IAddress;
}

/**
 * Exactly one default, always.
 *
 * With two, the checkout picks whichever the array happens to yield first —
 * which is stable enough to look correct in testing and wrong for whoever
 * changed their default last.
 */
function clearOtherDefaults(user: IUser, keepId: Types.ObjectId): void {
  user.addresses.forEach((address) => {
    if (!address._id.equals(keepId)) address.isDefault = false;
  });
}

export async function listAddresses(userId: string): Promise<IAddress[]> {
  const user = await loadUser(userId);
  // Default first, so the interface can take the head of the list.
  return [...user.addresses].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault),
  ) as IAddress[];
}

export async function addAddress(userId: string, input: AddressBody): Promise<IAddress> {
  const user = await loadUser(userId);

  if (user.addresses.length >= MAX_ADDRESSES) {
    throw new ApiError(
      400,
      `You can save up to ${MAX_ADDRESSES} addresses`,
      'ADDRESS_LIMIT_REACHED',
    );
  }

  // The first address is the default whether or not it was asked for —
  // otherwise a customer with exactly one saved address has none selected.
  const isFirst = user.addresses.length === 0;

  user.addresses.push({ ...input, isDefault: input.isDefault ?? isFirst } as IAddress);
  const created = user.addresses[user.addresses.length - 1];

  if (created.isDefault) clearOtherDefaults(user, created._id);

  /**
   * The name goes onto the account if there is not one there already.
   *
   * Sign-in is by OTP and never asks for a name, so this is the first point at
   * which we learn one — and it is the name that will be printed on the parcel.
   */
  if (!user.name) user.name = input.name;

  await user.save();
  return created as IAddress;
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: AddressPatch,
): Promise<IAddress> {
  const user = await loadUser(userId);
  const address = findOwn(user, addressId);

  Object.assign(address, input);

  if (input.isDefault) clearOtherDefaults(user, address._id);

  await user.save();
  return address;
}

export async function removeAddress(userId: string, addressId: string): Promise<void> {
  const user = await loadUser(userId);
  const address = findOwn(user, addressId);

  const wasDefault = address.isDefault;
  // `pull` by id rather than a method on the subdocument — IAddress is a plain
  // interface here, not a typed mongoose subdocument.
  user.addresses.pull(address._id);

  /**
   * Removing the default promotes whatever is left.
   *
   * Deleting an old address should not quietly leave a customer with no
   * address selected at checkout and no indication of why.
   */
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();
}

/**
 * Deleting is permanent, and that is safe: an order embeds a *copy* of the
 * address it shipped to. Past orders keep showing where they actually went,
 * however the customer edits their address book afterwards.
 */
