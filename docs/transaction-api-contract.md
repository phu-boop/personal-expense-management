# Transaction API Contract

Tài liệu này mô tả contract API cho transaction domain đã triển khai trong backend.

## Base path

- `/api/wallets`

## Auth

Tất cả endpoint yêu cầu token JWT trong header:

```http
Authorization: Bearer <token>
```

---

## 1) Tạo transaction

### Endpoint

```http
POST /api/wallets/:walletId/transactions
```

### Request body

```json
{
  "amount": "250.50",
  "type": "INCOME",
  "date": "2026-01-15T12:00:00Z",
  "category": "507f1f77bcf86cd799439011",
  "note": "bonus"
}
```

### Validation

- `amount`: required, > 0
- `type`: required, phải là `INCOME` hoặc `EXPENSE`
- `date`: required, ISO datetime hợp lệ
- `category`: optional, phải là ObjectId hợp lệ
- `note`: optional

### Success response

Status: `201 Created`

```json
{
  "transaction": {
    "_id": "64f...",
    "tenantId": "64f...",
    "userId": "64f...",
    "walletId": "64f...",
    "amount": "250.50",
    "type": "INCOME",
    "date": "2026-01-15T12:00:00Z",
    "note": "bonus",
    "category": "507f1f77bcf86cd799439011",
    "createdAt": "2026-01-15T12:00:00Z",
    "updatedAt": "2026-01-15T12:00:00Z"
  }
}
```

### Error responses

```json
{
  "error": "ValidationError",
  "message": "amount must be a positive decimal"
}
```

```json
{
  "error": "InsufficientBalance",
  "message": "Insufficient wallet balance"
}
```

```json
{
  "error": "WalletNotFound",
  "message": "Wallet not found"
}
```

---

## 2) Sửa transaction

### Endpoint

```http
PATCH /api/wallets/:walletId/transactions/:transactionId
```

### Request body

```json
{
  "amount": "250.00",
  "type": "EXPENSE",
  "date": "2026-01-20T00:00:00Z",
  "note": "updated note"
}
```

### Validation

- Tối thiểu 1 trong các field sau phải có mặt:
  - `amount`
  - `type`
  - `date`
  - `note`
- `amount` nếu có thì phải > 0
- `type` nếu có thì phải là `INCOME` hoặc `EXPENSE`
- `date` nếu có phải là ISO datetime hợp lệ

### Success response

Status: `200 OK`

```json
{
  "transaction": {
    "_id": "64f...",
    "tenantId": "64f...",
    "userId": "64f...",
    "walletId": "64f...",
    "amount": "250.00",
    "type": "EXPENSE",
    "date": "2026-01-20T00:00:00Z",
    "note": "updated note",
    "createdAt": "2026-01-15T12:00:00Z",
    "updatedAt": "2026-01-21T08:00:00Z"
  }
}
```

### Error responses

```json
{
  "error": "ValidationError",
  "message": "At least one field must be provided"
}
```

```json
{
  "error": "InsufficientBalance",
  "message": "Insufficient wallet balance"
}
```

```json
{
  "error": "TransactionNotFound",
  "message": "Transaction not found"
}
```

---

## 3) Lấy lịch sử transaction theo wallet

### Endpoint

```http
GET /api/wallets/:walletId/transactions
```

### Query params

- `from`: ISO datetime bắt đầu range
- `to`: ISO datetime kết thúc range
- `limit`: số bản ghi tối đa mỗi page
- `cursor`: opaque cursor từ page trước

Example:

```http
GET /api/wallets/64f123/transactions?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&limit=20
```

### Success response

Status: `200 OK`

```json
{
  "openingBalance": "1000",
  "transactions": [
    {
      "_id": "64f...",
      "tenantId": "64f...",
      "userId": "64f...",
      "walletId": "64f...",
      "amount": "100",
      "type": "INCOME",
      "date": "2026-01-01T00:00:00Z",
      "note": "first",
      "balanceBefore": "1000",
      "balanceAfter": "1100"
    },
    {
      "_id": "64f...",
      "tenantId": "64f...",
      "userId": "64f...",
      "walletId": "64f...",
      "amount": "50",
      "type": "EXPENSE",
      "date": "2026-01-01T00:00:00Z",
      "note": "second",
      "balanceBefore": "1100",
      "balanceAfter": "1050"
    }
  ],
  "nextCursor": "eyJkYXRlIjo...",
  "hasMore": false,
  "limit": 20
}
```

### Lưu ý quan trọng

- `openingBalance` là balance ngay trước transaction đầu tiên của page
- `balanceBefore` và `balanceAfter` được derive trên server khi trả response
- Không lưu `balanceBefore` / `balanceAfter` vào DB
- Sắp xếp canonical theo:
  - `date ASC`
  - `createdAt ASC`
  - `_id ASC`

---

## 4) Business rules quan trọng cho frontend

### Amount

- string hoặc number
- phải > 0
- server dùng Decimal exact arithmetic, không dùng float unsafe

### Type

Chỉ nhận:

```json
"INCOME"
"EXPENSE"
```

### Date

- lưu dưới dạng UTC trong DB
- query range dùng half-open interval: `[fromDate, toDate)`

### Cursor pagination

- `nextCursor` là opaque string
- frontend chỉ cần gửi lại nguyên giá trị trong query param `cursor`
- không tự suy logic cursor

### Tenant isolation

- wallet và transaction luôn phải thuộc authenticated tenant + user
- frontend không được cố tình sửa `walletId` hoặc `transactionId` để chạm khác tenant

---

## 5) Error format chung

```json
{
  "error": "ValidationError",
  "message": "..."
}
```

Các `error` phổ biến:

- `ValidationError`
- `WalletNotFound`
- `TransactionNotFound`
- `InsufficientBalance`
- `InternalServerError`

---

## 6) Gợi ý gọi API từ frontend

### Tạo

```ts
const res = await fetch(`/api/wallets/${walletId}/transactions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    amount: '250.50',
    type: 'INCOME',
    date: '2026-01-15T12:00:00Z',
    note: 'bonus',
  }),
});
```

### Sửa

```ts
const res = await fetch(`/api/wallets/${walletId}/transactions/${transactionId}`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    amount: '300',
    type: 'EXPENSE',
    note: 'updated',
  }),
});
```

### Lấy history

```ts
const res = await fetch(
  `/api/wallets/${walletId}/transactions?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&limit=20`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
```

---

## 7) Lưu ý khi ghép frontend

- Không tự tính running balance nếu server đã trả `balanceBefore` / `balanceAfter`
- Không lưu `balanceBefore` / `balanceAfter` vào transaction model
- Không gửi dữ liệu `wallet.currentBalance` từ client để update
- Hãy truyền `nextCursor` nguyên bản từ server cho page tiếp theo
- Với range date, nên dùng `from` và `to` trong ISO UTC format

---

## 8) Status hiện tại

API transaction đã được mount vào server và test đã pass với transaction service + route test.
