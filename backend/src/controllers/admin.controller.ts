import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as adminService from '../services/admin.service';
import * as auditService from '../services/audit.service';
import * as routerService from '../services/router.service';
import {
  getRadminSocketPath,
  showFreeradiusClients,
} from '../services/freeradius.service';
import { redact } from '../utils/redact';

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
      targetId: id, details: redact(req.body as Record<string, unknown>), ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
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
      targetId: id, details: redact(req.body as Record<string, unknown>), ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
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

export async function listPlans(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await adminService.getPlans();
    res.status(200).json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
}

export async function createPlan(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = await adminService.createPlan(req.body);
    await auditService.logAction({
      adminId: req.user!.id, action: 'plan.create', targetEntity: 'plan',
      targetId: plan.id, details: redact(req.body as Record<string, unknown>), ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
}

export async function updatePlan(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const plan = await adminService.updatePlan(id, req.body);
    await auditService.logAction({
      adminId: req.user!.id, action: 'plan.update', targetEntity: 'plan',
      targetId: id, details: redact(req.body as Record<string, unknown>), ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
}

export async function deletePlan(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await adminService.deletePlan(id);
    await auditService.logAction({
      adminId: req.user!.id, action: 'plan.delete', targetEntity: 'plan',
      targetId: id, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'Plan deleted successfully' } });
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
    const { decision, rejection_reason } = req.body;
    const payment = await adminService.reviewPayment(id, req.user!.id, decision, rejection_reason);
    await auditService.logAction({
      adminId: req.user!.id, action: `payment.${decision}`, targetEntity: 'payment',
      targetId: id, details: { decision, rejection_reason }, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
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

// ----- Admin management -----

export async function listAdmins(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const admins = await adminService.listAdmins();
    res.status(200).json({ success: true, data: admins });
  } catch (error) {
    next(error);
  }
}

export async function createAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    const admin = await adminService.createAdmin({ name, email, password });
    await auditService.logAction({
      adminId: req.user!.id, action: 'admin.create', targetEntity: 'admin',
      targetId: admin.id, details: { name, email }, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(201).json({ success: true, data: admin });
  } catch (error) {
    next(error);
  }
}

export async function setAdminActive(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { is_active } = req.body as { is_active: boolean };
    const admin = await adminService.deactivateAdmin(id, is_active, req.user!.id);
    await auditService.logAction({
      adminId: req.user!.id, action: is_active ? 'admin.activate' : 'admin.deactivate', targetEntity: 'admin',
      targetId: id, details: { is_active }, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: admin });
  } catch (error) {
    next(error);
  }
}

export async function resetAdminPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { password } = req.body as { password: string };
    await adminService.resetAdminPassword(id, password);
    await auditService.logAction({
      adminId: req.user!.id, action: 'admin.password_reset', targetEntity: 'admin',
      targetId: id, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'Password reset successfully' } });
  } catch (error) {
    next(error);
  }
}

export async function deleteAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await adminService.deleteAdmin(id, req.user!.id);
    await auditService.logAction({
      adminId: req.user!.id, action: 'admin.delete', targetEntity: 'admin',
      targetId: id, ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'Admin deleted successfully' } });
  } catch (error) {
    next(error);
  }
}

export async function getUserDetail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const detail = await adminService.getUserDetail(id);
    res.status(200).json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
}

export async function createRouterForUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const targetUserId = req.params.id as string;
    const { overrideQuota, ...routerBody } = req.body as {
      name: string;
      overrideQuota?: boolean;
    };
    const result = await routerService.createRouter(
      targetUserId,
      { name: routerBody.name },
      { skipQuotaCheck: overrideQuota === true },
    );
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'router.create_for_user',
      targetEntity: 'router',
      targetId: result.router.id,
      details: { userId: targetUserId, name: routerBody.name, overrideQuota: !!overrideQuota },
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(201).json({ success: true, data: { router: result.router, vpnIp: result.vpnIp, steps: result.steps } });
  } catch (error) {
    next(error);
  }
}

export async function getRouterSetupGuide(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const routerId = req.params.id as string;
    const guide = await routerService.getSetupGuideForAdmin(routerId);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'router.view_setup_guide',
      targetEntity: 'router',
      targetId: routerId,
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: guide });
  } catch (error) {
    next(error);
  }
}

export async function getSystemStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await adminService.getSystemStatus();
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}

async function socketReachability(): Promise<{ path: string; exists: boolean; readable: boolean; writable: boolean }> {
  const path = getRadminSocketPath();
  let exists = false;
  let readable = false;
  let writable = false;
  try {
    await access(path, fsConstants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    try { await access(path, fsConstants.R_OK); readable = true; } catch { /* noop */ }
    try { await access(path, fsConstants.W_OK); writable = true; } catch { /* noop */ }
  }
  return { path, exists, readable, writable };
}

/**
 * GET /admin/freeradius/status
 *
 * Returns enough state for an admin to diagnose FreeRADIUS reachability:
 *  - socket presence / permissions from the backend's POV
 *  - the current `show clients` output, so the admin can verify which
 *    NASes are loaded in FreeRADIUS
 *
 * No reload-history field now that new routers are picked up via the
 * dynamic_clients path in freeradius/raddb/sites-enabled/dynamic-clients
 * instead of being pushed in by a backend-triggered restart.
 */
export async function getFreeradiusStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [socket, clients] = await Promise.all([
      socketReachability(),
      showFreeradiusClients(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        socket,
        clients: {
          raw: clients,
          lineCount: clients ? clients.split('\n').filter((l) => l.trim().length > 0).length : 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
