# API Documentation

## Base URL
- Local: `http://localhost:5000`
- Frontend origin should be allowed in CORS config

## Authentication
Most routes require a Bearer JWT token in the `Authorization` header.

Example:

```http
Authorization: Bearer <token>
```

## Authentication endpoints

### POST /api/auth/google
Creates or retrieves the user and returns a signed JWT.

Request body:

```json
{
  "token": "google_id_token"
}
```

Response:

```json
{
  "token": "jwt_token",
  "user": {
    "_id": "...",
    "email": "user@example.com",
    "name": "User Name",
    "tenantId": "...",
    "role": "OWNER"
  }
}
```

Possible errors:
- `400` missing Google token
- `401` invalid token / authentication failed

## Wallet endpoints

### GET /api/wallets
Returns wallets scoped to the authenticated tenant and user.

Supports paginated query params:
- `page`
- `limit`
- `search`

Example:

```http
GET /api/wallets?page=1&limit=20
```

### POST /api/wallets
Creates a wallet.

Request body:

```json
{
  "name": "Cash",
  "accountNumber": "1234",
  "initialBalance": 500000,
  "startDate": "2026-01-01T00:00:00.000Z",
  "colorTheme": "emerald"
}
```

## Transaction endpoints

### GET /api/transactions
Returns transaction history for the current user and tenant.

Supported query params:
- `limit`
- `before`
- `walletId`
- `type`
- `category`
- `dateFrom`
- `dateTo`

### POST /api/transactions
Creates a transaction.

Request body:

```json
{
  "walletId": "wallet_object_id",
  "type": "EXPENSE",
  "amount": 150000,
  "category": "Food",
  "date": "2026-08-22T00:00:00.000Z",
  "note": "Lunch"
}
```

### GET /api/transactions/statement
Returns statement summary + transactions for a date range.

Query params:
- `walletId` (optional)
- `startDate` (required)
- `endDate` (required)

## Export endpoints

### POST /api/exports
Creates an export job.

Request body:

```json
{
  "walletId": "wallet_object_id",
  "startDate": "2026-08-01",
  "endDate": "2026-08-31",
  "format": "pdf"
}
```

Response:

```json
{
  "jobId": "...",
  "status": "COMPLETED",
  "format": "pdf",
  "expiresAt": "2026-08-23T00:00:00.000Z"
}
```

### GET /api/exports/:id
Returns current export job status.

### GET /api/exports/:id/download
Downloads the generated PDF/XLSX file.

## Health endpoints

### GET /api/health
Returns app health status including DB and Redis connectivity.

### GET /api/ready
Returns ready status when required services are connected.

## Error response conventions

```json
{
  "message": "Human readable error"
}
```

Common HTTP status codes:
- `200` OK
- `201` Created
- `400` Validation error
- `401` Authentication required or invalid token
- `403` Permission denied
- `404` Entity not found
- `409` Export not ready yet
- `500` Server error
