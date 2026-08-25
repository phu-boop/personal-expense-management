# System Architecture for Personal Expense Management

## 1. Mục tiêu kiến trúc

Hệ thống cần hỗ trợ:
- 1 user có nhiều tài khoản ngân hàng / ví
- mỗi ví có hàng triệu giao dịch
- báo cáo theo từng khoảng thời gian
- xuất PDF/Excel cho báo cáo lớn
- multi-tenant trong tương lai
- khả năng scale đến hàng triệu request / phút

Do đó, kiến trúc nên tách rõ:
- client UI
- API layer
- service layer
- data layer
- background worker
- cache layer
- storage layer

---

## 2. Kiến trúc tổng quan

```text
Client (React + TypeScript)
        |
        v
API Gateway / Backend (Node.js + Express + TypeScript)
        |
        +--> Auth Service
        +--> Wallet Service
        +--> Transaction Service
        +--> Report Service
        +--> Export Service
        |
        +--> Redis Cache
        |
        +--> MongoDB primary/replica
        |
        +--> Queue (BullMQ / RabbitMQ)
        |
        +--> Object Storage (S3 / MinIO)
        |
        +--> Background Workers
```

---

## 3. Tầng Client

### Công nghệ
- React
- TypeScript
- Vite
- Axios

### Vai trò
- render UI
- gọi API
- quản lý state
- hiển thị dashboard, transactions, wallets, statement

### Lưu ý
Client không nên chứa logic nghiệp vụ quan trọng như tính số dư, báo cáo, hay update balance. Tất cả logic này phải đi qua server.

---

## 4. Tầng API

### Công nghệ
- Node.js
- Express.js
- TypeScript
- JWT / Google OAuth

### Những module chính
- `AuthController`
- `WalletController`
- `TransactionController`
- `ReportController`
- `ExportController`

### API behavior
- validate request
- xác thực user
- kiểm tra quyền truy cập theo `userId`
- gọi service tương ứng
- cập nhật DB
- trả response chuẩn

### Mẫu response chuẩn
```json
{
  "success": true,
  "data": {},
  "message": "OK"
}
```

---

## 5. Tầng service

### Auth Service
- login Google
- tạo user nếu chưa tồn tại
- issue JWT
- refresh token nếu cần

### Wallet Service
- tạo ví
- cập nhật thông tin ví
- tính tổng số dư user
- validate ví hợp lệ

### Transaction Service
- thêm giao dịch thu/chi
- sửa giao dịch (amount, type, date, note)
- xóa giao dịch
- validate số dư không âm khi chi
- cập nhật `wallets.currentBalance`
- ghi `transaction_audit`

### Report Service
- tính số dư đầu kỳ / cuối kỳ
- tính tổng thu / chi trong khoảng thời gian
- lấy chi tiết giao dịch
- trả data cho statement UI

### Export Service
- tạo job export PDF/Excel
- push task vào queue
- xử lý background
- lưu file đọc được

---

## 6. Data layer

### Database
MongoDB

### Collections
- `users`
- `wallets`
- `categories`
- `transactions`
- `transaction_audit`
- `export_jobs`

### Nhóm dữ liệu
- Master data: `users`, `wallets`, `categories`
- Transaction ledger: `transactions`
- Audit trail: `transaction_audit`
- Job tracking: `export_jobs`

### Indexing strategy
- `transactions`: `{ userId, walletId, date }`
- `transactions`: `{ userId, walletId, type, date }`
- `wallets`: `{ userId, isActive }`
- `export_jobs`: `{ userId, status, createdAt }`

---

## 7. Cache layer

### Redis
Sử dụng Redis cho:
- session / token cache
- dashboard summary cache
- report cache for recent queries
- lock / deduplication trong export job
- rate limiting

### Ví dụ cache keys
```text
wallet:summary:{userId}
report:statement:{userId}:{walletId}:{from}:{to}
transaction:latest:{userId}:{limit}
```

### Lợi ích
- giảm số lần query MongoDB
- giúp dashboard phản hồi nhanh
- giảm tải khi nhiều request hot

---

## 8. Background job + queue

### Vì sao cần queue?
Bởi vì export báo cáo hàng triệu dòng không nên chạy trong request HTTP. Nếu chạy trực tiếp, API sẽ chậm hoặc treo.

### Mô hình
```text
API -> create export job -> push queue -> worker -> generate PDF/Excel -> save file -> update job status
```

### Công nghệ đề xuất
- BullMQ với Redis
- hoặc RabbitMQ

### Job type
- `generate_report_pdf`
- `generate_report_excel`
- `recalculate_wallet_balance`
- `rebuild_summary_snapshot`

---

## 9. Object storage

### Dùng cho file export
- S3-compatible storage
- MinIO nếu chạy local/dev

### Lưu file export
```text
exports/{tenantId}/{userId}/{jobId}/report.xlsx
exports/{tenantId}/{userId}/{jobId}/report.pdf
```

### Lợi ích
- tránh lưu file trong DB
- dễ download
- tối ưu cho báo cáo lớn

---

## 10. Kiểm soát số dư và giao dịch

### Quy tắc
- mỗi giao dịch phải thuộc đúng ví
- nếu type = EXPENSE thì không được vượt quá balance
- mỗi giao dịch tạo mới phải cập nhật số dư ví
- chỉnh sửa giao dịch cần update lại cả `balanceBefore` và `balanceAfter`

### Transaction update flow
```text
Client -> API -> TransactionService
  -> load current tx
  -> validate new data
  -> compute delta
  -> update transaction
  -> update wallet currentBalance
  -> write audit log
  -> return success
```

---

## 11. Báo cáo Statement

### Input
- `walletId`
- `fromDate`
- `toDate`

### Output
- `openingBalance`
- `totalIncome`
- `totalExpense`
- `closingBalance`
- `transactions[]`

### Cách xử lý
- query trong khoảng thời gian theo `walletId`
- tính tổng thu / chi
- lấy dữ liệu từ `transactions`
- dùng `wallets.currentBalance` hoặc snapshot nếu cần để tăng tốc

### Tối ưu hóa
- precompute summary by day/week/month
- store trong `wallet_balance_snapshots`
- chỉ query các dòng cần hiển thị cho report

---

## 12. Thiết kế multi-tenant

### Mục tiêu
Cho phép nhiều tenant / khách hàng sống trên cùng 1 hệ thống, cách ly dữ liệu.

### Mỗi collection nên có
```js
tenantId: ObjectId
```

### Ví dụ
- `users` thuộc một tenant
- `wallets` thuộc tenant
- `transactions` thuộc tenant

### Multi-tenant security model
- user chỉ xem data thuộc tenant của mình
- mọi query filter bắt buộc tenantId
- index bắt đầu bằng `tenantId`

### Index đề xuất
```js
{ tenantId: 1, userId: 1, walletId: 1, date: -1 }
```

---

## 13. Scale strategy

### Level 1: Single instance
- 1 Node API
- 1 MongoDB primary
- 1 Redis

### Level 2: Production-ready
- 2-3 API replicas behind load balancer
- MongoDB replica set
- Redis cluster / master-slave
- queue workers scale horizontally

### Level 3: High-scale
- shard MongoDB by `tenantId` or `userId`
- distribute workers
- partition storage for export files
- cache hot queries at Redis
- use read replicas for analytics/reporting

---

## 14. Practical design for the project

### Start simple, scale later
Dự án nên bắt đầu với:
- 1 API service
- 1 MongoDB database
- Redis cache
- BullMQ worker
- object storage for exports

Sau đó mới nâng cấp:
- multi-instance API
- sharding
- more workers
- summary tables
- tenant-aware architecture

---

## 15. Kết luận

Kiến trúc này giải quyết đúng 3 vấn đề chính:
1. tính năng nghiệp vụ: wallet + transactions + statement
2. performance: cache + index + background reports
3. scale: multi-tenant + queue + sharding-ready architecture

Nó không phải là một mô hình “rất tối giản”, nhưng cũng không quá phức tạp cho một hệ thống quản lý chi tiêu. Đây là mức kiến trúc phù hợp để bắt đầu và mở rộng theo thời gian.

---

## 16. Recommended stack

- Frontend: React + TypeScript
- Backend: Node.js + Express + TypeScript
- Auth: Google OAuth + JWT
- Database: MongoDB
- Cache: Redis
- Queue: BullMQ / RabbitMQ
- Storage: MinIO / S3
- Deployment: Docker + Docker Compose

---

## 17. Recommended next steps

1. Tạo server project structure
2. Define Mongoose schemas
3. Implement auth + wallet + transaction APIs
4. Implement statement/report service
5. Add export jobs with queue
6. Add Redis cache + tenant validation

Nếu muốn, tôi có thể làm tiếp bước kế tiếp: viết Mongoose schema hoặc tạo server folder thật sự cho dự án này.
