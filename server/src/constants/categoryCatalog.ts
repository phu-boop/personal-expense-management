export type CategoryCatalogItem = {
  _id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
};

export const CATEGORY_CATALOG: CategoryCatalogItem[] = [
  { _id: '67b1b3fd5a7a470d2f4d0a01', name: 'Food & Drink', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a02', name: 'Shopping', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a03', name: 'Transport', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a04', name: 'Bills', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a05', name: 'Entertainment', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a06', name: 'Other Expense', type: 'EXPENSE' },
  { _id: '67b1b3fd5a7a470d2f4d0a07', name: 'Salary', type: 'INCOME' },
  { _id: '67b1b3fd5a7a470d2f4d0a08', name: 'Business', type: 'INCOME' },
  { _id: '67b1b3fd5a7a470d2f4d0a09', name: 'Gift', type: 'INCOME' },
  { _id: '67b1b3fd5a7a470d2f4d0a10', name: 'Other Income', type: 'INCOME' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORY_CATALOG.map((item) => [item._id, item.name]));
export const CATEGORY_OPTIONS_BY_TYPE = {
  EXPENSE: CATEGORY_CATALOG.filter((item) => item.type === 'EXPENSE'),
  INCOME: CATEGORY_CATALOG.filter((item) => item.type === 'INCOME'),
} as const;

export const resolveCategoryName = (category?: string | { _id?: string; name?: string } | null) => {
  if (!category) return 'Uncategorized';
  if (typeof category === 'string') {
    return CATEGORY_BY_ID[category] ?? 'Uncategorized';
  }
  if (typeof category === 'object') {
    return category.name || CATEGORY_BY_ID[category._id ?? ''] || 'Uncategorized';
  }
  return 'Uncategorized';
};
