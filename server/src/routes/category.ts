import express from 'express';
import { authenticate } from '../middleware/auth';
import { listCategories, createCategory, updateCategory, deleteCategory } from '../controllers/categoryController';

const router = express.Router();

router.use(authenticate);
router.get('/categories', listCategories);
router.post('/categories', createCategory);
router.patch('/categories/:categoryId', updateCategory);
router.delete('/categories/:categoryId', deleteCategory);

export default router;
