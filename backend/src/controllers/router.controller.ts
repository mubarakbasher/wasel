import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as routerService from '../services/router.service';
import { runHealthCheck } from '../services/routerHealth.service';
import { applyHotspotTemplate } from '../services/hotspotTemplate.service';
import { HOTSPOT_TEMPLATES, HOTSPOT_ACCENT_PRESETS } from '../hotspot-templates/manifest';
import { config } from '../config';

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

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
}

export async function listHotspotTemplates(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const templates = HOTSPOT_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      previewUrl: `${config.PUBLIC_BASE_URL}/api/v1/public/hotspot-templates/${t.id}/preview.png`,
      defaultAccent: t.defaultAccent,
      accentPresets: HOTSPOT_ACCENT_PRESETS,
    }));

    res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
}

export async function setHotspotTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const routerId = req.params.id as string;
    const userId = req.user!.id;
    const { templateId, accentColor } = req.body as { templateId: string; accentColor?: string };

    const router = await applyHotspotTemplate(userId, routerId, templateId, accentColor);

    res.status(200).json({
      success: true,
      data: router,
    });
  } catch (error) {
    next(error);
  }
}
