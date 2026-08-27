# Thiết kế Database cho dự án Personal Expense Management

## 1. Mục tiêu

Dự án quản lý chi tiêu cá nhân cần hỗ trợ:
- 1 user có nhiều ví
- 1 ví có nhiều giao dịch
- giao dịch có thể sửa: số tiền, loại, ngày, ghi chú
- báo cáo theo ví và khoảng thời gian
- xuất báo cáo PDF/Excel
- mở rộng lên multi-tenant, hàng triệu giao dịch

MongoDB là lựa chọn phù hợp vì dữ liệu có dạng document, query báo cáo theo thời gian và ví khá thuận tiện.

---

## 2. Kiến trúc dữ liệu tổng quan

### Collections chính
- `users`
- `wallets`
- `categories`
- `transactions`
- `transaction_audit`
- `export_jobs`

### Mô hình quan hệ
- `users` 1 - n `wallets`
- `users` 1 - n `categories`
- `users` 1 - n `transactions`
- `wallets` 1 - n `transactions`
- `transactions` 1 - n `transaction_audit`
- `users` 1 - n `export_jobs`

---

## 3. Collection `users`

Lưu thông tin người dùng.

```js
{
  _id: ObjectId,
  email: "abc@gmail.com",
  googleId: "google_123456",
  name: "Phú",
  avatarUrl: "https://...",
  isActive: true,
  createdAt: ISODate(),
  updatedAt: ISODate(),
  lastLoginAt: ISODate()
}
```

### Index
```js
{ email: 1 }, { unique: true }
{ googleId: 1 }, { unique: true }
{ createdAt: -1 }
```

---

## 4. Collection `wallets`

Lưu các ví của người dùng.

```js
{
  _id: ObjectId,
  userId: ObjectId,
  name: "Ví tiền mặt",
  bankName: "Vietcombank",
  accountNumber: "123456789",
  currency: "VND",
  openingBalance: 10000000,
  openingDate: ISODate("2025-01-01"),
  currentBalance: 9500000,
  isActive: true,
  createdAt: ISODate(),
  updatedAt: ISODate()
}
```

### Giải thích
- `openingBalance`: số dư ban đầu của ví
- `openingDate`: ngày bắt đầu tính toán cho ví
- `currentBalance`: số dư hiện tại, dùng để query nhanh

### Index
```js
{ userId: 1, isActive: 1 }
{ userId: 1, name: 1 }
```

---

## 5. Collection `categories`

Lưu danh mục thu/chi.

```js
{
  _id: ObjectId,
  userId: ObjectId,
  name: "Ăn uống",
  type: "EXPENSE", // INCOME | EXPENSE
  isSystem: true,
  createdAt: ISODate()
}
```

### Ví dụ dữ liệu
- `Salary`, `Business`, `Gift`, `Other Income`
- `Food & Drink`, `Shopping`, `Transport`, `Bills`, `Entertainment`, `Other Expense`

### Index
```js
{ userId: 1, type: 1, name: 1 }
```

---

## 6. Collection `transactions`

Lưu tất cả khoản thu/chi.

```js
{
  _id: ObjectId,
  userId: ObjectId,
  walletId: ObjectId,
  categoryId: ObjectId,
  type: "EXPENSE", // INCOME | EXPENSE
  amount: 50000,
  currency: "VND",
  date: ISODate("2026-08-25"),
  note: "Ăn trưa với đồng nghiệp",
  status: "ACTIVE", // ACTIVE | DELETED
  balanceBefore: 10000000,
  balanceAfter: 9950000,
  createdAt: ISODate(),
  updatedAt: ISODate(),
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

### Vì sao cần `balanceBefore` / `balanceAfter`?
- dễ hiển thị lịch sử
- dễ tính báo cáo
- dễ debug khi giao dịch bị sửa
- giảm phải tính lại nhiều lần trên server

### Index
```js
{ userId: 1, walletId: 1, date: -1 }
{ userId: 1, walletId: 1, type: 1, date: -1 }
{ userId: 1, date: -1 }
{ userId: 1, categoryId: 1 }
{ walletId: 1, date: -1 }
```

### Lưu ý cho sửa giao dịch
Khi sửa giao dịch, không chỉ update field, mà cần:
1. lưu old values
2. tính lại `balanceBefore`, `balanceAfter`
3. cập nhật `wallets.currentBalance`
4. ghi audit log

---

## 7. Collection `transaction_audit`

Theo dõi lịch sử thay đổi giao dịch.

```js
{
  _id: ObjectId,
  transactionId: ObjectId,
  userId: ObjectId,
  walletId: ObjectId,
  changedBy: ObjectId,
  changedAt: ISODate(),
  oldValues: {
    amount: 50000,
    type: "EXPENSE",
    date: ISODate("2026-08-20")
  },
  newValues: {
    amount: 75000,
    type: "INCOME",
    date: ISODate("2026-08-25")
  },
  changeReason: "User edited transaction"
}
```

### Index
```js
{ transactionId: 1, changedAt: -1 }
{ userId: 1, changedAt: -1 }
```

### Mục đích
- phục vụ yêu cầu chỉnh sửa giao dịch
- dễ debug và khôi phục nếu sai dữ liệu

---

## 8. Collection `export_jobs`

Dùng cho xuất báo cáo PDF / Excel.

```js
{
  _id: ObjectId,
  userId: ObjectId,
  walletId: ObjectId,
  fromDate: ISODate("2026-08-01"),
  toDate: ISODate("2026-08-31"),
  type: "STATEMENT", // PDF | EXCEL
  status: "PENDING", // PENDING | RUNNING | DONE | FAILED
  fileUrl: "https://...",
  createdAt: ISODate(),
  updatedAt: ISODate()
}
```

### Index
```js
{ userId: 1, status: 1, createdAt: -1 }
```

---

## 9. Cách xử lý sửa giao dịch

Yêu cầu: "giao dịch có thể sửa dc: số tiền, type, date".

### Logic đề xuất
1. Lấy transaction cũ
2. Tính delta với giao dịch mới
3. Recalculate số dư ví
4. Update `transactions`
5. Ghi vào `transaction_audit`
6. Update `wallets.currentBalance`

### Ví dụ
Giả sử ví đang có 10.000.000:
- cũ: chi 50.000
- mới: chi 200.000

Thì `currentBalance` phải thay đổi tương ứng và `transaction_audit` lưu log cũ và mới.

---

## 10. Thiết kế báo cáo

### Yêu cầu báo cáo sai kê
- lọc theo ví
- lọc theo khoảng thời gian
- hiển thị:
  - số dư đầu kỳ
  - tổng thu
  - tổng chi
  - số dư cuối kỳ
  - danh sách giao dịch chi tiết

### Cách tính
Query `transactions` theo:
- `userId`
- `walletId`
- `date >= fromDate && date <= toDate`

Sau đó:
```js
openingBalance = wallet.openingBalance + sum(thu-chi trước fromDate)

incomeTotal = sum(amount where type = 'INCOME')
expenseTotal = sum(amount where type = 'EXPENSE')
closingBalance = openingBalance + incomeTotal - expenseTotal
```

---

## 11. Tối ưu hóa cho phần nâng cao

### A. 1 user có 100 tài khoản NH, mỗi tài khoản có hàng triệu giao dịch
Khuyến nghị:
- index mạnh theo `userId`, `walletId`, `date`
- tránh query không có filter
- sharding theo `userId` hoặc `tenantId`

### B. Xuất báo cáo PDF/Excel hàng triệu dòng
Không nên xuất trực tiếp trên request. Nên:
- tạo job trong `export_jobs`
- chạy background worker
- lưu file lên S3/MinIO
- trả URL cho client download

### C. Multi-tenant
Thêm field `tenantId` vào tất cả collection nếu sẽ mở rộng SaaS.

```js
{
  tenantId: ObjectId
}
```

---

## 12. Khuyến nghị cuối cùng

### Dùng MongoDB với cấu trúc sau:
- `users`
- `wallets`
- `categories`
- `transactions`
- `transaction_audit`
- `export_jobs`

### Dùng index tối thiểu:
```js
users: { email, googleId }
wallets: { userId, name }
categories: { userId, type, name }
transactions: { userId, walletId, date, type }
transaction_audit: { transactionId, changedAt }
export_jobs: { userId, status, createdAt }
```

### Đặc điểm ưu việt
- dễ mở rộng
- hỗ trợ sửa giao dịch tốt
- dễ báo cáo
- dễ xuất file
- phù hợp với yêu cầu nâng cao

---

## 13. Kết luận

Thiết kế DB này đáp ứng đầy đủ:
- login bằng Google
- nhiều ví
- thu/chi
- tự động cập nhật số dư
- sửa giao dịch
- báo cáo theo thời gian
- mở rộng cho export PDF/Excel và multi-tenant

Nếu muốn, tôi có thể làm tiếp bước tiếp theo: tạo file `server-schema.ts` hoặc `mongoose` model chuẩn cho toàn bộ DB.
