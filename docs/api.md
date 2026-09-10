# API documentation

## 1. Overview

The backend exposes a REST API for wallet management, transaction operations, statement viewing, auth, and asynchronous export jobs.

All protected routes require a JWT bearer token in the Authorization header:

```http
Authorization: Bearer <token>
```

The API is designed around tenant-scoped data access and wallet-level financial correctness.

---

## 2. Authentication

### 2.1 Google login

#### POST /api/auth/google

Request body:

```json
{
  "googleToken": "<google-oauth-id-token>"
}
```

Success response:

```json
{
  "token": "jwt-token",
  "user": {
    "_id": "user-id",
    "email": "user@example.com",
    "name": "User Name",
    "tenantId": "tenant-id"
  }
}
```

Notes:

- The backend verifies the Google token using the configured Google client ID.
- If the user does not exist, a new user record is created.
- If the user has no tenant, a tenant is created automatically.

---

## 3. Wallet endpoints

### 3.1 Get wallet

#### GET /api/wallets/:walletId

Authorization required.

Success response:

```json
{
  "_id": "wallet-id",
  "name": "Main Wallet",
  "tenantId": "tenant-id",
  "userId": "user-id",
  "initialBalance": "1000.00",
  "currentBalance": "1500.00",
  "version": 3
}
```

Notes:

- `currentBalance` is the canonical wallet balance
- `initialBalance` is the starting balance for the wallet
- `version` may be used for optimistic write coordination

### 3.2 Create wallet

#### POST /api/wallets

Request body:

```json
{
  "name": "Travel Wallet",
  "initialBalance": "500.00"
}
```

Success response:

```json
{
  "wallet": {
    "_id": "wallet-id",
    "name": "Travel Wallet",
    "initialBalance": "500.00",
    "currentBalance": "500.00"
  }
}
```

---

## 4. Transaction endpoints

### 4.1 Create transaction

#### POST /api/wallets/:walletId/transactions

Authorization required.

Request body:

```json
{
  "amount": "200.00",
  "type": "EXPENSE",
  "date": "2026-08-20T10:00:00Z",
  "category": "category-id",
  "note": "Groceries"
}
```

Valid values:

- `amount`: positive decimal string, greater than zero
- `type`: `INCOME` or `EXPENSE`
- `date`: ISO timestamp in UTC

Success response:

```json
{
  "transaction": {
    "_id": "txn-id",
    "walletId": "wallet-id",
    "amount": "200.00",
    "type": "EXPENSE",
    "date": "2026-08-20T10:00:00.000Z",
    "note": "Groceries"
  },
  "wallet": {
    "_id": "wallet-id",
    "currentBalance": "1300.00"
  }
}
```

Failure cases:

- 400: invalid payload
- 401/403: unauthorized
- 409: insufficient balance or business conflict
- 404: wallet not found

### 4.2 Get transactions for a wallet and range

#### GET /api/wallets/:walletId/transactions

Authorization required.

Query parameters:

- `from` (optional): start date / ISO timestamp
- `to` (optional): end date / ISO timestamp
- `page` (optional): paging if the API supports it
- `limit` (optional): page size

Example:

```http
GET /api/wallets/abc123/transactions?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z
```

Success response:

```json
{
  "openingBalance": "1200.00",
  "transactions": [
    {
      "_id": "txn-id",
      "date": "2026-08-03T00:00:00.000Z",
      "type": "INCOME",
      "amount": "50.00",
      "balanceBefore": "1200.00",
      "balanceAfter": "1250.00",
      "note": "salary"
    }
  ],
  "totalIncome": "350.00",
  "totalExpense": "200.00",
  "finalRunningBalance": "1350.00"
}
```

Notes:

- range logic must follow half-open semantics: `[fromDate, toDate)`
- `openingBalance` is not the wallet current balance; it is the balance before the range starts

### 4.3 Edit transaction

#### PATCH /api/wallets/:walletId/transactions/:transactionId

Authorization required.

Allowed mutable fields:

- amount
- type
- date
- note
- category

The request body is partial JSON. Example:

```json
{
  "amount": "300.00",
  "type": "EXPENSE",
  "note": "Updated note"
}
```

Success response:

```json
{
  "transaction": {
    "_id": "txn-id",
    "amount": "300.00",
    "type": "EXPENSE",
    "note": "Updated note"
  },
  "wallet": {
    "_id": "wallet-id",
    "currentBalance": "1300.00"
  }
}
```

Important rules:

- editing note/date only must not change wallet balance
- changing type from INCOME to EXPENSE or vice versa must update the balance according to the old/new effect delta
- walletId must not be mutable by patch

### 4.4 Delete transaction

#### DELETE /api/wallets/:walletId/transactions/:transactionId

Authorization required.

Behavior:

- delete the transaction
- adjust wallet balance by reversing the transaction effect
- invalidate affected snapshots if necessary

Repository and service layers are expected to ensure the wallet remains valid after deletion.

---

## 5. Statement semantics

The statement API is expected to compute values in a way consistent with the canonical ordering:

- transaction order: date ASC, createdAt ASC, _id ASC
- running balance is computed in that order
- UI may reverse the list for display, but calculation must remain chronological

### Required values

- `openingBalance`: wallet balance before the query range begins
- `transactions[]`: rows inside the range
- `totalIncome`: sum of income rows in range
- `totalExpense`: sum of expense rows in range
- `finalRunningBalance`: last balance after processing the last row in range

---

## 6. Export endpoints

### 6.1 Create export job

#### POST /api/exports

Authorization required.

Request body:

```json
{
  "walletId": "wallet-id",
  "fromDate": "2026-08-01T00:00:00Z",
  "toDate": "2026-08-31T00:00:00Z",
  "format": "XLSX"
}
```

Supported formats:

- `XLSX`
- `PDF`

Success response:

```json
{
  "jobId": "export-job-id",
  "status": "PENDING"
}
```

The server enqueues the export job asynchronously and returns a handle for polling or download.

### 6.2 Get export job status

#### GET /api/exports/:jobId

Authorization required.

Success response:

```json
{
  "_id": "job-id",
  "walletId": "wallet-id",
  "status": "COMPLETED",
  "format": "XLSX",
  "pages": 18,
  "totalPages": 18,
  "fileKey": "path/to/file.xlsx"
}
```

### 6.3 Download export

#### GET /api/exports/:jobId/download

Authorization required.

Behavior:

- returns the generated file if the job is completed
- returns an error if the job is not ready or not found

---

## 7. Error model

Typical server responses:

- 400: validation or malformed input
- 401: missing or invalid token
- 403: user lacks access to wallet/tenant
- 404: resources not found
- 409: business conflict such as insufficient balance
- 500: internal error

Example error payload:

```json
{
  "error": "InsufficientBalance",
  "message": "This change would make the wallet balance negative."
}
```

---

## 8. Security and access control

- API must verify JWT on protected routes
- user access is limited to their own tenant and wallet records
- wallet and transaction mutation must check tenant ownership before updating
- export routes must verify the user is allowed to access the target wallet

---

## 9. Backend invariants to enforce

The API and services are expected to maintain the following invariants:

- currentBalance is consistent with transaction effects
- statement calculations are based on canonical ordering
- half-open date ranges are respected
- snapshots are only optimization data, not the source of truth
- export jobs must track final metadata accurately

---

## 10. Notes for implementation and review

This API contract is meant to be stable enough for product and engineering review, but it still depends on the exact backend behavior for some edge conditions. For example, the exact status code for certain validation failures may vary by middleware or validator implementation, so the contract should be read as a behavioral guide rather than a rigid status-code guarantee in every edge case.

The most important correctness expectations are:

- money math must be exact
- range semantics must be consistent
- running balance must be deterministic and auditable
- export artifacts must preserve the same financial facts as the API data
