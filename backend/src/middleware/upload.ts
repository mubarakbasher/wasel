import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import FileType from 'file-type';
import { AppError } from './errorHandler';
import logger from '../config/logger';

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/app/uploads';
const RECEIPTS_DIR = path.join(UPLOAD_ROOT, 'receipts');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
      cb(null, RECEIPTS_DIR);
    } catch (err) {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      logger.error('Upload destination not writable', {
        userId,
        dir: RECEIPTS_DIR,
        error: err instanceof Error ? err.message : String(err),
      });
      cb(
        new AppError(500, 'Upload directory is not writable', 'UPLOAD_DIR_UNWRITABLE'),
        RECEIPTS_DIR,
      );
    }
  },
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

/**
 * After multer has written the uploaded file to disk, sniff the file's magic
 * bytes to confirm the actual content matches an allowed image type. This
 * defends against attackers who lie about Content-Type and rename extensions
 * to bypass the fileFilter check (which only inspects the client-supplied
 * MIME string and extension).
 *
 * On mismatch: delete the file from disk and respond with 400.
 */
export async function verifyUploadMagicBytes(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    next();
    return;
  }

  try {
    // file-type v16 reads just enough of the file to identify the format;
    // no need to hand-manage a buffer.
    const detected = await FileType.fromFile(file.path);

    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      // Unlink the disk file before rejecting so we don't leave attacker payloads sitting in /uploads.
      await fs.promises.unlink(file.path).catch(() => {});
      next(
        new AppError(
          400,
          'Uploaded file content does not match an allowed image type (JPEG, PNG, or WebP)',
          'INVALID_FILE_CONTENT',
        ),
      );
      return;
    }

    next();
  } catch (err) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    logger.error('Upload magic-byte verification failed', {
      userId,
      path: file.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Best-effort cleanup on any failure during verification.
    await fs.promises.unlink(file.path).catch(() => {});
    next(err instanceof AppError ? err : new AppError(400, 'Could not verify uploaded file', 'UPLOAD_VERIFY_FAILED'));
  }
}

export const RECEIPTS_PUBLIC_PREFIX = '/uploads/receipts';
