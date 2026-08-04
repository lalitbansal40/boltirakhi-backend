import { SETTING_DEFAULTS, Setting, type ISetting } from '../../models/Setting';
import type { UpdateSettingInput } from './setting.schema';

/**
 * Always returns a document, even on a database that has never seen one.
 *
 * A plain `findOne` returns null the first time, which would put a null guard
 * at every call site — and one of those guards would eventually be forgotten,
 * on the day the settings row happened to be missing.
 *
 * Deliberately not cached in memory. A stale copy that only clears on restart
 * means an admin changes the free-delivery threshold, sees no effect, and
 * nobody can explain why. It is one small document per read.
 */
export async function getSettings(): Promise<ISetting> {
  return Setting.findOneAndUpdate(
    { key: 'store' },
    { $setOnInsert: { key: 'store', ...SETTING_DEFAULTS } },
    // `returnDocument: 'after'`, not `new: true` — mongoose 9 deprecated the
    // latter and warns on every single call.
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ) as Promise<ISetting>;
}

export async function updateSettings(input: UpdateSettingInput): Promise<ISetting> {
  // Read first so the row exists; `findOneAndUpdate` with upsert would
  // otherwise create a half-filled document from a partial patch.
  const settings = await getSettings();

  Object.assign(settings, input);
  await settings.save();

  return settings;
}
