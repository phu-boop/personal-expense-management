export const formatMoney = (value: number | string | null | undefined, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '0';

  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
  }).format(numeric);
};

export const formatInputMoney = (value: string) => {
  const rawDigits = value.replace(/\D/g, '');
  if (!rawDigits) return '';
  const numeric = Number(rawDigits);
  return formatMoney(numeric);
};
