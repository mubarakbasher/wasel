import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as voucherService from '../services/voucher.service';
import { pool } from '../config/database';
import { notifyBulkCreationComplete } from '../services/notification.service';
import logger from '../config/logger';

export async function createVouchers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const routerId = req.params.id as string;
    const vouchers = await voucherService.createVouchers(req.user!.id, routerId, req.body);

    // Fire-and-forget notification for bulk (count > 1)
    if (vouchers.length > 1) {
      pool.query('SELECT name FROM routers WHERE id = $1', [routerId])
        .then(r => {
          const routerName = r.rows[0]?.name || 'Unknown Router';
          return notifyBulkCreationComplete(req.user!.id, vouchers.length, routerName);
        })
        .catch(err => logger.error('Failed to send bulk creation notification', { error: err }));
    }

    res.status(201).json({
      success: true,
      data: vouchers,
    });
  } catch (error) {
    next(error);
  }
}

export async function getVouchers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await voucherService.getVouchersByRouter(req.user!.id, req.params.id as string, req.query);
    res.status(200).json({
      success: true,
      data: result.vouchers,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const voucher = await voucherService.getVoucherById(req.user!.id, req.params.id as string, req.params.vid as string);
    res.status(200).json({
      success: true,
      data: voucher,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const voucher = await voucherService.updateVoucher(req.user!.id, req.params.id as string, req.params.vid as string, req.body);
    res.status(200).json({
      success: true,
      data: voucher,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await voucherService.deleteVoucher(req.user!.id, req.params.id as string, req.params.vid as string);
    res.status(200).json({
      success: true,
      data: { message: 'Voucher deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}

export async function bulkDeleteVouchers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await voucherService.bulkDeleteVouchers(req.user!.id, req.params.id as string, req.body);
    res.status(200).json({
      success: true,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    next(error);
  }
}
