import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as adminService from '../services/admin.service';
import * as auditService from '../services/audit.service';

export async function listUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, search, status } = req.query as Record<string, string>;
    const result = await adminService.getUsers(Number(page) || 1, Number(limit) || 20, search, status);
    res.status(200).json({
      success: true,
      data: result.users,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const user = await adminService.updateUser(id, req.body);
    await auditService.logAction({
      adminId: req.user!.id, action: 'user.update', targetEntity: 'user',
      targetId: id, details: req.body, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await adminService.deleteUser(id);
    await auditService.logAction({
      adminId: req.user!.id, action: 'user.delete', targetEntity: 'user',
      targetId: id, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'User deleted successfully' } });
  } catch (error) {
    next(error);
  }
}

export async function listSubscriptions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, userId } = req.query as Record<string, string>;
    const result = await adminService.getSubscriptions(Number(page) || 1, Number(limit) || 20, status, userId);
    res.status(200).json({
      success: true,
      data: result.subscriptions,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const subscription = await adminService.updateSubscription(id, req.body);
    await auditService.logAction({
      adminId: req.user!.id, action: 'subscription.update', targetEntity: 'subscription',
      targetId: id, details: req.body, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await adminService.deleteSubscription(id);
    await auditService.logAction({
      adminId: req.user!.id, action: 'subscription.delete', targetEntity: 'subscription',
      targetId: id, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'Subscription deleted successfully' } });
  } catch (error) {
    next(error);
  }
}

export async function listPayments(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status } = req.query as Record<string, string>;
    const result = await adminService.getPayments(Number(page) || 1, Number(limit) || 20, status);
    res.status(200).json({
      success: true,
      data: result.payments,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function reviewPayment(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { decision } = req.body;
    const payment = await adminService.reviewPayment(id, req.user!.id, decision);
    await auditService.logAction({
      adminId: req.user!.id, action: `payment.${decision}`, targetEntity: 'payment',
      targetId: id, details: { decision }, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
}

export async function getStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await adminService.getStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

export async function listRouters(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, search } = req.query as Record<string, string>;
    const result = await adminService.getRouters(Number(page) || 1, Number(limit) || 20, status, search);
    res.status(200).json({
      success: true,
      data: result.routers,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function listAuditLogs(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, adminId, action, targetEntity, from, to } = req.query as Record<string, string>;
    const result = await adminService.getAuditLogs(
      Number(page) || 1, Number(limit) || 20, adminId, action, targetEntity, from, to,
    );
    res.status(200).json({
      success: true,
      data: result.logs,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}
