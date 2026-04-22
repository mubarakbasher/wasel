import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { config } from '../config';
import * as routerService from '../services/router.service';
import { runHealthCheck } from '../services/routerHealth.service';
import { provisionRouter } from '../services/routerProvision.service';
import { pool } from '../config/database';

export async function createRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await routerService.createRouter(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      data: {
        router: result.router,
        vpnIp: result.vpnIp,
        steps: result.steps,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Public callback endpoint — called by the RouterOS `/tool fetch` in setup step 7.
 * Authenticated only by HMAC-SHA256(JWT_ACCESS_SECRET, routerId) so no JWT is needed.
 * Always returns 200 so the `/tool fetch` on the router does not error out.
 */
export async function scriptCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const routerId = req.query['routerId'] as string | undefined;
    const sig = req.query['sig'] as string | undefined;

    if (!routerId || !sig) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CALLBACK', message: 'missing routerId or sig' },
      });
      return;
    }

    const expected = createHmac('sha256', config.JWT_ACCESS_SECRET).update(routerId).digest('hex');

    // timingSafeEqual requires equal-length buffers; mismatched lengths would throw.
    let sigValid = false;
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      sigValid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    } catch {
      sigValid = false;
    }

    if (!sigValid) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'bad signature' },
      });
      return;
    }

    // Fire-and-forget — errors are swallowed inside finalizePendingRouter so
    // the router always gets a 200 back from its /tool fetch call.
    void routerService.finalizePendingRouter(routerId);

    res.status(200).json({ success: true, data: { message: 'ok' } });
  } catch (error) {
    next(error);
  }
}

export async function getRouters(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const routers = await routerService.getRoutersByUser(req.user!.id);
    res.status(200).json({
      success: true,
      data: routers,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const router = await routerService.getRouterById(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: router,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const router = await routerService.updateRouter(req.user!.id, req.params.id as string, req.body);
    res.status(200).json({
      success: true,
      data: router,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await routerService.deleteRouter(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: { message: 'Router deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}

export async function getRouterStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await routerService.getRouterStatus(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSetupGuide(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guide = await routerService.getSetupGuide(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: guide,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRouterHealth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const routerId = req.params.id as string;
    const userId = req.user!.id;
    const refresh = (req.query.refresh as string | undefined) === 'true';

    const report = await runHealthCheck(userId, routerId, { force: refresh });

    // Fetch provision fields from router row
    const provRow = await pool.query<{
      last_provision_status: string | null;
      last_provision_error: unknown;
      last_provision_at: Date | null;
      provision_applied_at: Date | null;
    }>(
      `SELECT last_provision_status, last_provision_error, last_provision_at,
              provision_applied_at
         FROM routers WHERE id = $1 AND user_id = $2`,
      [routerId, userId],
    );

    const prov = provRow.rows[0] ?? {};

    res.status(200).json({
      success: true,
      data: {
        ...report,
        provisionStatus: prov.last_provision_status ?? null,
        provisionError: prov.last_provision_error ?? null,
        provisionAt: prov.last_provision_at ? new Date(prov.last_provision_at).toISOString() : null,
        provisionAppliedAt: prov.provision_applied_at ? new Date(prov.provision_applied_at).toISOString() : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function reprovisionRouter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await provisionRouter(
      req.user!.id,
      req.params.id as string,
      { trigger: 'manual' },
    );
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

