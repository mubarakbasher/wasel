import { z } from 'zod';

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message body is required').max(2000, 'Message is too long'),
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Opaque keyset cursor from a previous response `meta.nextCursor`. */
  cursor: z.string().max(512).optional(),
});

export const conversationUserIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});
