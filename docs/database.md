# Database Documentation

## Overview
The application persists user, wallet, transaction, and export metadata in MongoDB. The database is designed around multi-tenant data isolation.

## Collections

### users
Purpose: identity and account metadata for each authenticated user.

Key fields:
- `googleId`
- `email`
- `name`
- `avatar`
- `tenantId`
- `role`

Important indexes:
- unique on `googleId`
- unique on `email`
- compound index on `tenantId + email`

### tenants
Purpose: tenant container for multi-tenant separation.

Key fields:
- `name`
- `slug`
- `ownerId`
- `status`

### wallets
Purpose: represent bank accounts or cash sources.

Key fields:
- `tenantId`
- `userId`
- `name`
- `accountNumber`
- `initialBalance`
- `currentBalance`
- `startDate`
- `colorTheme`

Important indexes:
- `tenantId + userId + createdAt`
- `tenantId + userId + name`
- `tenantId + userId + accountNumber`

### transactions
Purpose: store every money movement.

Key fields:
- `tenantId`
- `userId`
- `walletId`
- `type` (`INCOME` or `EXPENSE`)
- `amount`
- `category`
- `date`
- `note`
- `balanceBefore`
- `balanceAfter`

Important indexes:
- `tenantId + userId + date + _id`
- `tenantId + userId + walletId + date + _id`
- `tenantId + userId + type + date + _id`
- `tenantId + userId + category + date + _id`

### exportjobs
Purpose: track background export status and metadata.

Key fields:
- `tenantId`
- `userId`
- `format`
- `status`
- `filters`
- `fileKey`
- `error`
- `createdAt`
- `completedAt`
- `expiresAt`

Important indexes:
- `tenantId + userId + createdAt`
- status index
- expiresAt index

## Design assumptions
- Every wallet and transaction is scoped to the authenticated tenant and user.
- Transactions are append-only financial events.
- Balance is derived from wallet state and transaction history.
- Export records are meant to be retained for a TTL window.

## Transaction behavior
The transaction creation flow updates wallet balance based on the transaction type and validates the result against wallet sufficiency rules before persisting.

## Notes
This app intentionally keeps critical financial semantics in application logic instead of relying solely on database constraints, to keep business validation explicit and readable.
