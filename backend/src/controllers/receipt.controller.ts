import { Request, Response, NextFunction } from 'express';
import path from 'path';
import FileType from 'file-type';
import { AppError } from '../middleware/errorHandler';
import { RECEIPTS_DIR, ALLOWED_MIME } from '../middleware/upload';
import { RECEIPT_NAME_RE, verifyReceiptLink } from '../utils/receiptLinks';

/** Serve a receipt image for a valid signed link (no Bearer auth: an <img> cannot send one). */
export async function serveReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const name = String(req.params.name);
    if (!RECEIPT_NAME_RE.test(name)) {
      throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    }
    if (!verifyReceiptLink(name, req.query.exp, req.query.sig)) {
      throw new AppError(403, 'Receipt link is invalid or expired', 'TOKEN_INVALID');
    }

    const filePath = path.join(RECEIPTS_DIR, name);
    let type: { mime: string } | undefined;
    try {
      type = await FileType.fromFile(filePath);
    } catch {
      throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    }
    if (!type || !ALLOWED_MIME.has(type.mime)) {
      throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    }

    // Set after helmet: the admin panel on another subdomain embeds these in an <img>.
    res.setHeader('Content-Type', type.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(filePath, { cacheControl: false, headers: {} }, (err) => {
      if (err && !res.headersSent) next(new AppError(404, 'Receipt not found', 'NOT_FOUND'));
    });
  } catch (error) {
    next(error);
  }
}
