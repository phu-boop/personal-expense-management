import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { buildTenantResourceFilter, buildTenantUserFilter, isRoleAllowed } from './tenantScope';

describe('tenantScope', () => {
  it('appends tenant and user scopes to user-related queries', () => {
    const tenantId = new mongoose.Types.ObjectId('67f000000000000000000001');
    const userId = new mongoose.Types.ObjectId('67f000000000000000000002');

    assert.deepEqual(buildTenantUserFilter(tenantId, userId), {
      tenantId,
      userId,
    });
  });

  it('prevents viewer role from write operations', () => {
    assert.equal(isRoleAllowed('VIEWER', 'read'), true);
    assert.equal(isRoleAllowed('VIEWER', 'write'), false);
    assert.equal(isRoleAllowed('OWNER', 'write'), true);
  });

  it('keeps tenant scope for resource access checks', () => {
    const tenantId = new mongoose.Types.ObjectId('67f000000000000000000003');
    const walletId = new mongoose.Types.ObjectId('67f000000000000000000004');

    assert.deepEqual(buildTenantResourceFilter(tenantId, walletId), {
      tenantId,
      _id: walletId,
    });
  });
});
