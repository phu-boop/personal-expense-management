import { Response } from 'express';
import mongoose from 'mongoose';
import Category, { CategoryType } from '../models/Category';
import { AuthRequest } from '../middleware/auth';

const DEFAULT_CATEGORIES = [
  { name: 'Food & Drink', type: CategoryType.EXPENSE },
  { name: 'Shopping', type: CategoryType.EXPENSE },
  { name: 'Transport', type: CategoryType.EXPENSE },
  { name: 'Bills', type: CategoryType.EXPENSE },
  { name: 'Entertainment', type: CategoryType.EXPENSE },
  { name: 'Other Expense', type: CategoryType.EXPENSE },
  { name: 'Salary', type: CategoryType.INCOME },
  { name: 'Business', type: CategoryType.INCOME },
  { name: 'Gift', type: CategoryType.INCOME },
  { name: 'Other Income', type: CategoryType.INCOME },
] as const;

const ensureDefaultCategories = async (tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) => {
  const existing = await Category.find({ tenantId, userId }).lean();
  if (existing.length > 0) {
    return;
  }

  await Category.insertMany(
    DEFAULT_CATEGORIES.map((category) => ({
      tenantId,
      userId,
      name: category.name,
      type: category.type,
      isDefault: true,
    }))
  );
};

export const listCategories = async (req: AuthRequest, res: Response) => {
  try {
    await ensureDefaultCategories(req.user!.tenantId!, req.user!.id);
    const categories = await Category.find({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
    }).sort({ type: 1, name: 1 }).lean();

    return res.json({
      success: true,
      categories: categories.map((category) => ({
        _id: category._id,
        name: category.name,
        type: category.type,
        isDefault: Boolean(category.isDefault),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch categories' });
  }
};

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { name, type } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    if (type !== CategoryType.INCOME && type !== CategoryType.EXPENSE) {
      return res.status(400).json({ success: false, message: 'Category type must be INCOME or EXPENSE' });
    }

    const category = await Category.create({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      name: name.trim(),
      type,
      isDefault: false,
    });

    return res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to create category' });
  }
};

export const updateCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;
    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ success: false, message: 'Invalid categoryId' });
    }

    const { name, type } = req.body ?? {};
    const update: Partial<{ name: string; type: CategoryType }> = {};

    if (typeof name === 'string' && name.trim()) {
      update.name = name.trim();
    }
    if (type === CategoryType.INCOME || type === CategoryType.EXPENSE) {
      update.type = type;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const category = await Category.findOneAndUpdate(
      {
        _id: categoryId,
        tenantId: req.user!.tenantId!,
        userId: req.user!.id,
      },
      { $set: update },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    return res.json({ success: true, data: category });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to update category' });
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;
    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ success: false, message: 'Invalid categoryId' });
    }

    const category = await Category.findOne({
      _id: categoryId,
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
    }).lean();

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (category.isDefault) {
      return res.status(400).json({ success: false, message: 'Default category cannot be deleted' });
    }

    await Category.deleteOne({ _id: categoryId, tenantId: req.user!.tenantId!, userId: req.user!.id });

    return res.json({ success: true, deleted: true, categoryId });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to delete category' });
  }
};
