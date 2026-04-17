import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as supportService from '../services/support.service';

// ---------- User ----------

export async function listMessages(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await supportService.listMessages(
      req.user!.id,
      Number(page) || 1,
      Number(limit) || 30,
    );
    res.status(200).json({
      success: true,
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        unreadAdminCount: result.unreadAdminCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const message = await supportService.sendUserMessage(req.user!.id, req.body.body);
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await supportService.markAdminMessagesRead(req.user!.id);
    res.status(200).json({ success: true, data: { unreadAdminCount: 0 } });
  } catch (error) {
    next(error);
  }
}

// ---------- Admin ----------

export async function listConversations(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit, search } = req.query as Record<string, string>;
    const result = await supportService.listConversations(
      Number(page) || 1,
      Number(limit) || 20,
      search,
    );
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (error) {
    next(error);
  }
}

export async function listConversationMessages(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.params.userId as string;
    const { page, limit } = req.query as Record<string, string>;
    const result = await supportService.listConversationMessages(
      userId,
      Number(page) || 1,
      Number(limit) || 30,
    );
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total, user: result.user },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminReply(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.params.userId as string;
    const message = await supportService.sendAdminMessage(userId, req.user!.id, req.body.body);
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
}

export async function adminMarkRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.params.userId as string;
    await supportService.markUserMessagesRead(userId);
    res.status(200).json({ success: true, data: { markedRead: true } });
  } catch (error) {
    next(error);
  }
}

export async function adminUnreadCount(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const count = await supportService.getAdminUnreadCount();
    res.status(200).json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    next(error);
  }
}
