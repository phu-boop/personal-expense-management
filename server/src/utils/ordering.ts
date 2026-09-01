import mongoose from 'mongoose';

export type Ordering = {
  date: Date | string;
  createdAt?: Date | string;
  _id?: mongoose.Types.ObjectId | string;
};

function toMillis(d?: Date | string): number {
  if (!d) return 0;
  if (d instanceof Date) return d.getTime();
  const parsed = Date.parse(String(d));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function idToString(id?: mongoose.Types.ObjectId | string): string {
  if (!id) return '';
  if (typeof id === 'string') return id;
  return id.toString();
}

/**
 * Compare two ordering tuples (date, createdAt, _id).
 * Returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareOrdering(a: Ordering, b: Ordering): number {
  const aDate = toMillis(a.date);
  const bDate = toMillis(b.date);
  if (aDate < bDate) return -1;
  if (aDate > bDate) return 1;

  const aCreated = toMillis(a.createdAt);
  const bCreated = toMillis(b.createdAt);
  if (aCreated < bCreated) return -1;
  if (aCreated > bCreated) return 1;

  const aId = idToString(a._id);
  const bId = idToString(b._id);
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

export function isBefore(a: Ordering, b: Ordering): boolean {
  return compareOrdering(a, b) < 0;
}

export function isAtOrAfter(a: Ordering, b: Ordering): boolean {
  return compareOrdering(a, b) >= 0;
}

/**
 * Build a Mongo predicate that matches documents with ordering strictly AFTER the provided cursor.
 * Cursor must contain `date`, `createdAt`, and `_id` (or compatible values).
 */
export function buildAfterPredicate(cursor: Ordering) {
  // (date > cursor.date)
  // OR (date == cursor.date AND createdAt > cursor.createdAt)
  // OR (date == cursor.date AND createdAt == cursor.createdAt AND _id > cursor._id)
  return {
    $or: [
      { date: { $gt: new Date(cursor.date) } },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $gt: new Date(cursor.createdAt ?? 0) } },
        ],
      },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $eq: new Date(cursor.createdAt ?? 0) } },
          { _id: { $gt: new mongoose.Types.ObjectId(String(cursor._id)) } },
        ],
      },
    ],
  };
}

/**
 * Build a Mongo predicate that matches documents with ordering at-or-after the provided cursor.
 * (date > cursor.date) OR (date == cursor.date AND createdAt > cursor.createdAt) OR
 * (date == cursor.date AND createdAt == cursor.createdAt AND _id >= cursor._id)
 */
export function buildAtOrAfterPredicate(cursor: Ordering) {
  return {
    $or: [
      { date: { $gt: new Date(cursor.date) } },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $gt: new Date(cursor.createdAt ?? 0) } },
        ],
      },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $eq: new Date(cursor.createdAt ?? 0) } },
          { _id: { $gte: new mongoose.Types.ObjectId(String(cursor._id)) } },
        ],
      },
    ],
  };
}

/**
 * Build a Mongo predicate that matches documents with ordering strictly BEFORE the provided cursor.
 */
export function buildBeforePredicate(cursor: Ordering) {
  // (date < cursor.date)
  // OR (date == cursor.date AND createdAt < cursor.createdAt)
  // OR (date == cursor.date AND createdAt == cursor.createdAt AND _id < cursor._id)
  return {
    $or: [
      { date: { $lt: new Date(cursor.date) } },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $lt: new Date(cursor.createdAt ?? 0) } },
        ],
      },
      {
        $and: [
          { date: { $eq: new Date(cursor.date) } },
          { createdAt: { $eq: new Date(cursor.createdAt ?? 0) } },
          { _id: { $lt: new mongoose.Types.ObjectId(String(cursor._id)) } },
        ],
      },
    ],
  };
}

export default {
  compareOrdering,
  isBefore,
  isAtOrAfter,
  buildAfterPredicate,
  buildBeforePredicate,
  buildAtOrAfterPredicate,
};
