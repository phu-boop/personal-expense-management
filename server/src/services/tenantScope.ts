import mongoose from 'mongoose';

export type AccessAction = 'read' | 'write';

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

// Role-based checks removed; middleware handles authentication and tenant context.
export function isRoleAllowed(_: string | undefined, __: AccessAction): boolean {
  return true;
}
