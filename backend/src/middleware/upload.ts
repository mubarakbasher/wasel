import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import FileType from 'file-type';
import { AppError } from './errorHandler';
import logger from '../config/logger';

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/app/uploads';
export const RECEIPTS_DIR = path.join(UPLOAD_ROOT, 'receipts');

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Stored extension comes from the magic-byte sniff, never from the client.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

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
  filename: (req, _file, cb) => {
    const userId = (req as Request & { user?: { id: string } }).user?.id ?? 'anon';
    // Temporary suffix; verifyUploadMagicBytes renames to the detected type.
    // file.originalname is never read.
    const name = `${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.upload`;
    // Remembered so a parse that dies mid-file (truncated body) can be cleaned up.
    (req as Request & { pendingUploadPath?: string }).pendingUploadPath = path.join(RECEIPTS_DIR, name);
    cb(null, name);
  },
});

export const uploadReceipt = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new AppError(400, 'Only JPEG, PNG, or WebP images are allowed', 'INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

/** Maps a multer/busboy/fs error from the upload parse to the AppError sent to the client. */
export function mapUploadError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'Receipt image is too large (max 5 MB)', 'VALIDATION_ERROR')
      : new AppError(400, 'Malformed upload', 'VALIDATION_ERROR');
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code === 'ECONNRESET' || code === 'ECONNABORTED') {
      return new AppError(400, 'Malformed upload', 'VALIDATION_ERROR');
    }
    // errno-style (ENOSPC, EACCES, EIO, EROFS...): our storage failed, not the client.
    if (/^E[A-Z]+$/.test(code)) {
      return new AppError(500, 'Receipt storage failed', 'UPLOAD_DIR_UNWRITABLE');
    }
  }
  return new AppError(400, 'Malformed upload', 'VALIDATION_ERROR');
}

/** Runs the multer single-file parse and maps its errors to AppErrors. */
export function uploadReceiptSingle(req: Request, res: Response, next: NextFunction): void {
  uploadReceipt.single('receipt')(req, res, (err?: unknown) => {
    if (!err) {
      next();
      return;
    }
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    const mapped = mapUploadError(err);
    if (mapped.statusCode >= 500) {
      const e = err as { code?: unknown; message?: unknown; stack?: unknown } | null;
      logger.error('Receipt storage failed', {
        userId,
        code: e?.code,
        error: err instanceof Error ? err.message : String(err),
        stack: e?.stack,
      });
    } else {
      logger.warn('Receipt upload rejected', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const pending = (req as Request & { pendingUploadPath?: string }).pendingUploadPath;
    if (pending) {
      fs.promises.unlink(pending).catch(() => {});
    }
    next(mapped);
  });
}

/**
 * Deletes the uploaded file when the response is generated with an error status,
 * so rejected uploads never linger on disk. Hooks res.end rather than 'finish'
 * (which never fires if the client hangs up) or 'close' (which can fire before
 * the handler runs). The path is read at that moment, after verifyUploadMagicBytes
 * may have renamed the file.
 */
export function cleanupUploadOnError(req: Request, res: Response, next: NextFunction): void {
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: unknown[]) {
    const filePath = (req as Request & { file?: Express.Multer.File }).file?.path;
    if (res.statusCode >= 400 && filePath) {
      fs.promises.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
          logger.warn('Could not remove rejected upload', { path: filePath, error: err.message });
        }
      });
    }
    return (originalEnd as (...a: unknown[]) => Response).apply(this, args);
  } as typeof res.end;
  next();
}

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

    // Rename to the extension of the detected type (never the client's).
    const ext = EXT_BY_MIME[detected.mime];
    const newPath = path.join(path.dirname(file.path), `${path.parse(file.filename).name}${ext}`);
    await fs.promises.rename(file.path, newPath);
    file.path = newPath;
    file.filename = path.basename(newPath);

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
