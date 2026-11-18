import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { cleanupUploadOnError, mapUploadError, uploadReceipt, uploadReceiptSingle } from '../middleware/upload';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasel-cleanup-'));
  const f = path.join(dir, 'x.png');
  fs.writeFileSync(f, 'x');
  return f;
}

function setup(statusCode: number) {
  const filePath = tmpFile();
  const originalEnd = vi.fn();
  const res = { statusCode, end: originalEnd } as unknown as Parameters<typeof cleanupUploadOnError>[1];
  const req = { file: { path: filePath } } as unknown as Parameters<typeof cleanupUploadOnError>[0];
  const next = vi.fn();
  cleanupUploadOnError(req, res, next);
  return { filePath, originalEnd, res, next };
}

describe('cleanupUploadOnError', () => {
  it('removes the file when the response is generated with a 4xx, without waiting for finish', async () => {
    const { filePath, originalEnd, res, next } = setup(403);
    expect(next).toHaveBeenCalledOnce();
    (res as unknown as { end: () => void }).end();
    expect(originalEnd).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fs.existsSync(filePath)).toBe(false));
  });

  it('keeps the file on success', async () => {
    const { filePath, originalEnd, res } = setup(200);
    (res as unknown as { end: () => void }).end();
    expect(originalEnd).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('mapUploadError', () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it('passes AppError through', () => {
    const e = new AppError(400, 'x', 'INVALID_FILE_TYPE');
    expect(mapUploadError(e)).toBe(e);
  });
  it('LIMIT_FILE_SIZE -> 413, other MulterError -> 400', () => {
    const big = mapUploadError(new multer.MulterError('LIMIT_FILE_SIZE'));
    expect([big.statusCode, big.code]).toEqual([413, 'VALIDATION_ERROR']);
    const other = mapUploadError(new multer.MulterError('LIMIT_UNEXPECTED_FILE'));
    expect([other.statusCode, other.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
  it('client aborts -> 400', () => {
    for (const c of ['ECONNRESET', 'ECONNABORTED']) {
      const e = mapUploadError(errno(c));
      expect([e.statusCode, e.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
  });
  it('storage errno -> 500 UPLOAD_DIR_UNWRITABLE', () => {
    for (const c of ['ENOSPC', 'EACCES', 'EIO', 'EROFS']) {
      const e = mapUploadError(errno(c));
      expect([e.statusCode, e.code]).toEqual([500, 'UPLOAD_DIR_UNWRITABLE']);
    }
  });
  it('parse errors and non-errors -> 400', () => {
    for (const x of [new Error('Malformed part header'), new Error('Unexpected end of form'), 'boom', null]) {
      const e = mapUploadError(x);
      expect([e.statusCode, e.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
  });
});

describe('uploadReceiptSingle storage failures', () => {
  it('logs a 5xx storage error at error level with the original code', () => {
    const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    vi.spyOn(uploadReceipt, 'single').mockReturnValue(((_req: unknown, _res: unknown, cb: (e?: unknown) => void) =>
      cb(enospc)) as unknown as ReturnType<typeof uploadReceipt.single>);
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const next = vi.fn();
    uploadReceiptSingle({ user: { id: 'u1' } } as never, {} as never, next);
    expect(errorLog).toHaveBeenCalledWith(
      'Receipt storage failed',
      expect.objectContaining({ userId: 'u1', code: 'ENOSPC', error: 'no space left on device' }),
    );
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500, code: 'UPLOAD_DIR_UNWRITABLE' });
    vi.restoreAllMocks();
  });
});
