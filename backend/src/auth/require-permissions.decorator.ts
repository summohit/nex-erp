import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export interface PermissionRequirement {
  resourceType: string;
  action: string;
}

export const RequirePermissions = (...permissions: PermissionRequirement[]) => SetMetadata(PERMISSIONS_KEY, permissions);
