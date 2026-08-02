import { Schema, model, type Document, type Model } from 'mongoose';

export interface ICounter extends Document<string> {
  _id: string;
  seq: number;
}

/**
 * One document per sequence, keyed by name (e.g. `order:2026`).
 * Only ever touched through an atomic `$inc`.
 */
const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter: Model<ICounter> = model<ICounter>('Counter', counterSchema);
