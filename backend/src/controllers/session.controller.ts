import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as sessionService from '../services/session.service';

export async function getActiveSessions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessions = await sessionService.getActiveSessions(req.user!.id, req.params.id as string);
    res.status(200).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    next(error);
  }
}

export async function disconnectSession(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await sessionService.disconnectSession(req.user!.id, req.params.id as string, req.params.sid as string);
    res.status(200).json({
      success: true,
      data: { message: 'Session disconnected successfully' },
    });
  } catch (error) {
    next(error);
  }
}

export async function getSessionHistory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await sessionService.getSessionHistory(req.user!.id, req.params.id as string, req.query);
    res.status(200).json({
      success: true,
      data: result.sessions,
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
