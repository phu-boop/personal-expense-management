import mongoose from 'mongoose';

export type TenantRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type AccessAction = 'read' | 'write';

export const TENANT_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

export function buildTenantUserFilter(
  tenantId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
) {
  return {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    userId: new mongoose.Types.ObjectId(String(userId)),
  };
}

export function buildTenantResourceFilter(
  tenantId: string | mongoose.Types.ObjectId,
  resourceId: string | mongoose.Types.ObjectId,
  extraFilter: Record<string, unknown> = {},
) {
  return {
    ...extraFilter,
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    _id: new mongoose.Types.ObjectId(String(resourceId)),
  };
}

export function isRoleAllowed(role: string | undefined, action: AccessAction): boolean {
  if (!role) {
    return false;
  }

  const normalizedRole = role.toUpperCase();

  if (action === 'read') {
    return ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].includes(normalizedRole);
  }

  if (action === 'write') {
    return ['OWNER', 'ADMIN', 'MEMBER'].includes(normalizedRole);
  }

  return false;
}
