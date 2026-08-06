import { SetMetadata } from '@nestjs/common';

export interface PermissionRequirement {
  module: string;
  action?: string;
}

export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...requirements: (string | PermissionRequirement)[]) => {
  const formatted = requirements.map(req => {
    if (typeof req === 'string') {
      return { module: req, action: 'VIEW' };
    }
    return { module: req.module, action: req.action || 'VIEW' };
  });
  return SetMetadata(PERMISSIONS_KEY, formatted);
};
