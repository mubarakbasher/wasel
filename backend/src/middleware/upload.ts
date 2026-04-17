import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request } from 'express';
import { AppError } from './errorHandler';

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/app/uploads';
const RECEIPTS_DIR = path.join(UPLOAD_ROOT, 'receipts');

fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECEIPTS_DIR),
  filename: (req, file, cb) => {
    const userId = (req as Request & { user?: { id: string } }).user?.id ?? 'anon';
    const ts = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${userId}-${ts}${ext}`);
  },
});

export const uploadReceipt = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new AppError(400, 'Only JPEG, PNG, or WebP images are allowed', 'INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

export const RECEIPTS_PUBLIC_PREFIX = '/uploads/receipts';
