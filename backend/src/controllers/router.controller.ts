import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as routerService from '../services/router.service';

export async function createRouter(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const router = await routerService.createRouter(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      data: router,
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
