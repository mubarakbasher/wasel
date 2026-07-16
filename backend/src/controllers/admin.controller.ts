import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as adminService from '../services/admin.service';
import * as announcementService from '../services/announcement.service';
import * as auditService from '../services/audit.service';
import * as routerService from '../services/router.service';
import * as voucherService from '../services/voucher.service';
import * as emailLogService from '../services/emailLog.service';
import * as emailTemplateService from '../services/emailTemplate.service';
import * as emailService from '../services/email.service';
import {
  getRadminSocketPath,
  showFreeradiusClients,
} from '../services/freeradius.service';
import { applyHotspotTemplate } from '../services/hotspotTemplate.service';
import { AppError } from '../middleware/errorHandler';
import { redact } from '../utils/redact';
import { toCsv } from '../utils/csv';

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

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

// Hard row cap for every export. Reuses the existing paginated list services
// with a single large page rather than adding streaming/unbounded SQL, so a
// runaway export can never pull an unbounded result set into memory.
const EXPORT_ROW_CAP = 10000;

function clientIp(req: AuthenticatedRequest): string {
  return Array.isArray(req.ip) ? req.ip[0] : req.ip || '';
}

/**
 * Send a generated CSV as a downloadable attachment. Content-Type is set before
 * res.send so Express does not fall back to text/html, and the filename encodes
 * the resource + UTC date (wasel-<resource>-YYYY-MM-DD.csv).
 */
function sendCsv(res: Response, resource: string, csv: string): void {
  const date = new Date().toISOString().slice(0, 10);
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wasel-${resource}-${date}.csv"`);
  res.send(csv);
}

export async function exportUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, status } = req.query as Record<string, string>;
    const { users } = await adminService.getUsers(1, EXPORT_ROW_CAP, search, status);
    const csv = toCsv(users, [
      { header: 'ID', value: (u) => u.id },
      { header: 'Name', value: (u) => u.name },
      { header: 'Email', value: (u) => u.email },
      { header: 'Business Name', value: (u) => u.business_name },
      { header: 'Verified', value: (u) => u.is_verified },
      { header: 'Active', value: (u) => u.is_active },
      { header: 'Created At', value: (u) => u.created_at },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'users.export_csv',
      targetEntity: 'users',
      targetId: 'export',
      details: redact({ filters: { search, status }, rowCount: users.length }),
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'users', csv);
  } catch (error) {
    next(error);
  }
}

export async function exportSubscriptions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, userId } = req.query as Record<string, string>;
    const { subscriptions } = await adminService.getSubscriptions(1, EXPORT_ROW_CAP, status, userId);
    const csv = toCsv(subscriptions, [
      { header: 'ID', value: (s) => s.id },
      { header: 'User Name', value: (s) => s.user_name },
      { header: 'User Email', value: (s) => s.user_email },
      { header: 'Plan Tier', value: (s) => s.plan_tier },
      { header: 'Status', value: (s) => s.status },
      { header: 'Start Date', value: (s) => s.start_date },
      { header: 'End Date', value: (s) => s.end_date },
      { header: 'Vouchers Used', value: (s) => s.vouchers_used },
      { header: 'Voucher Quota', value: (s) => s.voucher_quota },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'subscriptions.export_csv',
      targetEntity: 'subscriptions',
      targetId: 'export',
      details: redact({ filters: { status, userId }, rowCount: subscriptions.length }),
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'subscriptions', csv);
  } catch (error) {
    next(error);
  }
}

export async function exportPayments(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.query as Record<string, string>;
    const { payments } = await adminService.getPayments(1, EXPORT_ROW_CAP, status);
    const csv = toCsv(payments, [
      { header: 'ID', value: (p) => p.id },
      { header: 'User Name', value: (p) => p.user_name },
      { header: 'User Email', value: (p) => p.user_email },
      { header: 'Plan', value: (p) => p.plan_name ?? p.plan_tier },
      { header: 'Amount', value: (p) => p.amount },
      { header: 'Currency', value: (p) => p.currency },
      { header: 'Reference Code', value: (p) => p.reference_code },
      { header: 'Status', value: (p) => p.status },
      { header: 'Rejection Reason', value: (p) => p.rejection_reason },
      { header: 'Created At', value: (p) => p.created_at },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'payments.export_csv',
      targetEntity: 'payments',
      targetId: 'export',
      details: redact({ filters: { status }, rowCount: payments.length }),
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'payments', csv);
  } catch (error) {
    next(error);
  }
}

export async function exportAuditLogs(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { adminId, action, targetEntity, from, to } = req.query as Record<string, string>;
    const { logs } = await adminService.getAuditLogs(
      1, EXPORT_ROW_CAP, adminId, action, targetEntity, from, to,
    );
    const csv = toCsv(logs, [
      { header: 'Created At', value: (l) => l.created_at },
      { header: 'Admin Name', value: (l) => l.admin_name },
      { header: 'Admin Email', value: (l) => l.admin_email },
      { header: 'Action', value: (l) => l.action },
      { header: 'Target Entity', value: (l) => l.target_entity },
      { header: 'Target ID', value: (l) => l.target_id },
      { header: 'IP Address', value: (l) => l.ip_address },
      { header: 'Details', value: (l) => l.details },
    ]);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'audit_logs.export_csv',
      targetEntity: 'audit_logs',
      targetId: 'export',
      details: redact({ filters: { adminId, action, targetEntity, from, to }, rowCount: logs.length }),
      ipAddress: clientIp(req),
    });
    sendCsv(res, 'audit-logs', csv);
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

/**
 * POST /admin/routers/:id/reprovision
 *
 * Re-push a hotspot login-page template to a router on the owner's behalf.
 * templateId defaults to the router's stored hotspot_template_id; if neither is
 * supplied nor stored → 400 NO_TEMPLATE. Mirrors the operator setHotspotTemplate
 * response ({ data: RouterInfo }) verbatim — including the 200 with
 * data.hotspotTemplateStatus === 'failed' passthrough when the device apply
 * failed (applyHotspotTemplate swallows RouterOS errors rather than throwing).
 */
export async function reprovisionRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const routerId = req.params.id as string;
    const { templateId: bodyTemplateId } = req.body as { templateId?: string };

    const meta = await adminService.getRouterAdminMeta(routerId);
    const templateId = bodyTemplateId ?? meta.hotspotTemplateId;
    if (!templateId) {
      throw new AppError(
        400,
        'No template provided and router has no stored hotspot template',
        'NO_TEMPLATE',
      );
    }

    const router = await applyHotspotTemplate(meta.userId, routerId, templateId);

    await auditService.logAction({
      adminId: req.user!.id,
      action: 'router.reprovision',
      targetEntity: 'router',
      targetId: routerId,
      details: redact({ templateId, ownerId: meta.userId }),
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });

    res.status(200).json({ success: true, data: router });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /admin/routers/:id
 *
 * Delete a router on the owner's behalf via the operator cascade (purges RADIUS
 * creds, NAS row, tunnel subnet, WireGuard peer). Name is snapshotted before the
 * delete for the audit record.
 */
export async function deleteRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const routerId = req.params.id as string;

    const meta = await adminService.getRouterAdminMeta(routerId);
    await routerService.deleteRouter(meta.userId, routerId);

    await auditService.logAction({
      adminId: req.user!.id,
      action: 'router.delete',
      targetEntity: 'router',
      targetId: routerId,
      details: redact({ ownerId: meta.userId, name: meta.name }),
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });

    res.status(200).json({ success: true, data: { message: 'Router deleted successfully' } });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Platform-wide vouchers
// ---------------------------------------------------------------------------

export async function listVouchers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, search, status, routerId, userId } = req.query as Record<string, string>;
    const result = await adminService.getAllVouchers(
      Number(page) || 1,
      Number(limit) || 20,
      { search, status, routerId, userId },
    );
    res.status(200).json({
      success: true,
      data: result.vouchers,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function getVoucherDetail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const context = await adminService.getVoucherContext(id);
    const voucher = await voucherService.getVoucherById(context.userId, context.routerId, id);
    res.status(200).json({
      success: true,
      data: { ...voucher, owner: context.owner, router: context.router },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { status } = req.body as { status: 'active' | 'disabled' };
    const { userId, routerId } = await adminService.resolveVoucherOwner(id);
    const voucher = await voucherService.updateVoucher(userId, routerId, id, { status });
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'voucher.update',
      targetEntity: 'voucher',
      targetId: id,
      details: redact({ status, ownerId: userId }),
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    next(error);
  }
}

export async function deleteVoucher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { userId, routerId } = await adminService.resolveVoucherOwner(id);
    await voucherService.deleteVoucher(userId, routerId, id);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'voucher.delete',
      targetEntity: 'voucher',
      targetId: id,
      details: redact({ ownerId: userId, routerId }),
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { message: 'Voucher deleted successfully' } });
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

// ---------------------------------------------------------------------------
// Email log
// ---------------------------------------------------------------------------

export async function listEmailLog(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit, type, status, search, from, to } = req.query as Record<string, string>;
    const result = await emailLogService.getEmailLog({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      type,
      status: (status as 'sent' | 'failed') || undefined,
      search,
      from,
      to,
    });
    res.status(200).json({
      success: true,
      data: result.logs,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

export async function listEmailTemplates(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const templates = await emailTemplateService.listEmailTemplates();
    res.status(200).json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
}

export async function updateEmailTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { type, language } = req.params as { type: string; language: string };
    const template = await emailTemplateService.updateEmailTemplate(
      type,
      language,
      req.body as { subject?: string; body_html?: string; is_active?: boolean },
      req.user!.id,
    );
    const bodyRecord = req.body as Record<string, unknown>;
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'email_template.update',
      targetEntity: 'email_template',
      targetId: `${type}:${language}`,
      details: {
        type: req.params.type,
        language: req.params.language,
        fields: Object.keys(bodyRecord),
        subject_changed: 'subject' in bodyRecord,
        body_changed: 'body_html' in bodyRecord,
      },
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
}

export async function sendTestEmail(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { type, language } = req.body as { type: string; language: string };
    const adminEmail = req.user!.email;
    await emailService.sendTestEmail(type, language, adminEmail);
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'email.test_send',
      targetEntity: 'email_template',
      targetId: `${type}:${language}`,
      details: { type, language, to: adminEmail },
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(200).json({ success: true, data: { sent: true } });
  } catch (error) {
    next(error);
  }
}

export async function getStatsTimeseries(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { days } = req.query as Record<string, string>;
    const result = await adminService.getStatsTimeseries(Number(days) || 30);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Announcements (broadcast)
// ---------------------------------------------------------------------------

export async function createAnnouncement(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { titleEn, titleAr, bodyEn, bodyAr } = req.body as {
      titleEn: string;
      titleAr: string;
      bodyEn: string;
      bodyAr: string;
    };
    const result = await announcementService.createAnnouncement({
      adminId: req.user!.id,
      titleEn,
      titleAr,
      bodyEn,
      bodyAr,
    });
    await auditService.logAction({
      adminId: req.user!.id,
      action: 'announcement.send',
      targetEntity: 'announcement',
      targetId: result.id,
      details: redact({ titleEn, titleAr, recipientCount: result.recipientCount }),
      ipAddress: Array.isArray(req.ip) ? req.ip[0] : req.ip || '',
    });
    res.status(201).json({ success: true, data: { id: result.id, recipientCount: result.recipientCount } });
  } catch (error) {
    next(error);
  }
}

export async function listAnnouncements(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await announcementService.listAnnouncements(Number(page) || 1, Number(limit) || 20);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
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
 * Returns enough state for an admin to diagnose a RADIUS outage without SSH:
 *  - socket presence / permissions from the backend's POV
 *  - the current `show clients` output (dynamically-cached clients appear
 *    here after their first packet; postgres nas table is the source of truth)
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

