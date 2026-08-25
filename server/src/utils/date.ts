export const parseDateInput = (value?: string, endOfDay = false) => {
  if (!value && value !== '') return undefined;

  const raw = String(value).trim();
  if (!raw) return undefined;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }

  return parsed;
};

export const formatDateLabel = (value?: Date | string) => {
  if (!value) return 'Tất cả';

  const date = value instanceof Date ? value : parseDateInput(String(value));
  if (!date || Number.isNaN(date.getTime())) return 'Tất cả';

  return date.toLocaleDateString('vi-VN');
};
