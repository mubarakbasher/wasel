import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import * as profileService from '../services/profile.service';

export async function createProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await profileService.createProfile(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function getProfiles(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profiles = await profileService.getProfilesByUser(req.user!.id);
    res.status(200).json({
      success: true,
      data: profiles,
    });
  } catch (error) {
    next(error);
  }
}

export async function getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await profileService.getProfileById(req.user!.id, req.params.pid as string);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await profileService.updateProfile(req.user!.id, req.params.pid as string, req.body);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await profileService.deleteProfile(req.user!.id, req.params.pid as string);
    res.status(200).json({
      success: true,
      data: { message: 'Profile deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}
