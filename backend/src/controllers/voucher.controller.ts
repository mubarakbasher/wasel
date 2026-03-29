import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as voucherService from '../services/voucher.service';

export async function createVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const voucher = await voucherService.createVoucher(req.user!.id, req.params.id as string, req.body);
    res.status(201).json({
      success: true,
      data: voucher,
    });
  } catch (error) {
    next(error);
  }
}

export async function createVouchersBulk(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const vouchers = await voucherService.createVouchersBulk(req.user!.id, req.params.id as string, req.body);
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
