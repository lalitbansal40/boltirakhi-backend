import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'customer' | 'admin';

export interface IAddress {
  _id: Types.ObjectId;
  label?: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

export interface IUser extends Document<Types.ObjectId> {
  name: string;
  phone?: string;
  email?: string;
  passwordHash?: string;
  role: UserRole;
  addresses: Types.DocumentArray<IAddress>;
  isBlocked: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(plain: string): Promise<boolean>;
}

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'India' },
    isDefault: { type: Boolean, default: false },
  },
  {
    // Addresses are edited and removed by id from the account screen.
    _id: true,
    validateBeforeSave: true,
  },
);

// 6 digits is an India rule. Applying it to every address would reject the
// Dubai and other overseas orders this store is partly built for.
addressSchema.path('pincode').validate(function (value: string) {
  if (this.country !== 'India') return true;
  return /^\d{6}$/.test(value);
}, 'Indian pincode must be 6 digits');

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },

    // unique + sparse on both: an admin has an email and no phone, a customer
    // has a phone and no email. Without sparse the second user with the field
    // absent collides on null.
    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },

    // Never returned by a plain query, so it cannot leak through a controller
    // that forgets to project it away.
    passwordHash: { type: String, select: false },

    role: { type: String, enum: ['customer', 'admin'], default: 'customer', index: true },
    addresses: { type: [addressSchema], default: [] },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.index({ createdAt: -1 });

/**
 * `passwordHash` is `select: false`, so a document loaded normally has no hash
 * and bcrypt would fail with "Illegal arguments" — a message that says nothing
 * about the real mistake. Fail with the actual cause instead.
 */
userSchema.methods.comparePassword = async function (
  this: IUser,
  plain: string,
): Promise<boolean> {
  if (!this.passwordHash) {
    throw new Error(
      'comparePassword called without passwordHash loaded — query with .select("+passwordHash")',
    );
  }

  return bcrypt.compare(plain, this.passwordHash);
};

export const User: Model<IUser> = model<IUser>('User', userSchema);
