# Personal Expense Management

## 1. Tổng quan dự án

Dự án này là một ứng dụng web quản lý chi tiêu cá nhân, giúp người dùng:
- quản lý nhiều ví/tài khoản ngân hàng
- ghi nhận khoản thu và chi
- theo dõi số dư theo thời gian
- xem lịch sử giao dịch
- xem báo cáo theo khoảng thời gian
- xuất báo cáo dạng PDF/Excel

Mục tiêu chính là xây dựng một hệ thống đơn giản, dễ dùng, có thể triển khai bằng Docker chỉ với một lệnh và chạy ổn định trên môi trường phát triển.

---

## 2. Stack công nghệ

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: MongoDB
- Cache: Redis
- Background worker: Node worker process
- Containerization: Docker + Docker Compose

---

## 3. Kiến trúc hiện tại

Cấu trúc dự án đang theo hướng:
- Client: giao diện người dùng
- Server: API và logic nghiệp vụ
- Worker: xử lý job background như xuất báo cáo
- MongoDB: lưu users, wallets, transactions, export jobs
- Redis: cache và hỗ trợ job/background

Tham khảo thêm:
- [plans/REQUIREMENTS.md](plans/REQUIREMENTS.md)
- [plans/system-architecture.md](plans/system-architecture.md)
- [plans/db-design.md](plans/db-design.md)

---

## 4. Mô tả yêu cầu theo kế hoạch

### 4.1 Các chức năng mong đợi theo yêu cầu
- Đăng nhập bằng Google
- Tự động tạo tài khoản nếu là user mới
- Tạo và quản lý nhiều ví
- Ghi các giao dịch thu/chi
- Tự động cập nhật số dư ví
- Kiểm tra số dư trước khi chi
- Xem báo cáo theo khoảng thời gian
- Xuất báo cáo PDF/Excel
- Dễ sử dụng trên cả desktop và mobile

### 4.2 Yêu cầu kỹ thuật và thiết kế
- Mô hình backend/client tách rõ
- MongoDB dùng cho dữ liệu nghiệp vụ
- Redis dùng cho cache và queue
- Docker Compose để khởi động đồng bộ toàn bộ stack
- Có khả năng mở rộng theo hướng multi-tenant và dữ liệu lớn

---

## 5. Tình trạng hiện tại (đã đạt / chưa đạt)

### 5.1 Đã đạt

Theo code hiện tại và kiểm tra chạy thực tế bằng Docker, các mục sau đã đạt được:

- Dự án có cấu trúc client/server/worker/database/cache rõ ràng.
- Có thể chạy bằng Docker Compose với một lệnh bootstrap.
- MongoDB replica set được tự khởi tạo lần đầu và ổn định ở trạng thái PRIMARY.
- Server backend có thể khởi động và phản hồi `/api/ready` thành công.
- Redis và Mongo đã chạy cùng stack trong Docker.
- Hệ thống đã xử lý được vấn đề font PDF trong container và PDF generation đã được kiểm chứng trên runtime Docker.

Kết quả kiểm chứng gần nhất:
- `rs.status()` trả về `stateStr: 'PRIMARY'`
- `GET /api/ready` trả về `200`
- PDF generation trong container đã thành công (`PDF_OK true`)

### 5.2 Chưa đạt / còn đang triển khai

Các mục dưới đây theo kế hoạch vẫn chưa được xem là hoàn thành đầy đủ:

- Chưa có xác nhận end-to-end đầy đủ cho toàn bộ flow đăng nhập Google với auth thật trên môi trường production-like.
- Chưa có xác nhận đầy đủ cho toàn bộ flow tạo ví, thêm/sửa/xóa giao dịch và kiểm tra số dư trên UI thật.
- Chưa có hệ thống report statement hoàn chỉnh theo đúng mọi tiêu chí báo cáo nâng cao từ kế hoạch.
- Chưa có queue worker thực sự mạnh mẽ cho export hàng triệu dòng theo kiến trúc đề xuất.
- Chưa có triển khai multi-tenant đầy đủ và scale lớn như mục nâng cao.
- Chưa có storage lưu file export kiểu S3/MinIO hoàn chỉnh trong môi trường production.

Nói ngắn gọn: dự án đã đạt mức nền tảng chạy ổn định được bằng Docker, nhưng vẫn còn phần lớn chức năng nghiệp vụ theo yêu cầu và mô hình nâng cao đang ở giai đoạn triển khai hoặc cần kiểm tra thực tế thêm.

---

## 6. Trạng thái khuyến nghị

Dự án hiện tại nên được xem là:
- `Foundation complete`: stack chạy ổn định, Mongo/Redis/Server/Worker được kết nối và chạy trong Docker
- `Feature completion in progress`: các chức năng nghiệp vụ theo yêu cầu cần kiểm thử từng màn hình và từng API
- `Production-scale architecture pending`: multi-tenant, huge dataset, queue export và object storage chưa cần thiết phải hoàn thiện cho giai đoạn hiện tại

---

## 7. Cách chạy nhanh

```bash
docker compose up --build -d
```

Sau đó truy cập:
- Frontend: http://localhost:5173
- Backend ready check: http://localhost:5000/api/ready

---

## 8. Ghi chú

Tài liệu chi tiết yêu cầu và thiết kế nằm trong thư mục [plans](plans):
- [plans/REQUIREMENTS.md](plans/REQUIREMENTS.md)
- [plans/system-architecture.md](plans/system-architecture.md)
- [plans/db-design.md](plans/db-design.md)

Đây là một bản tóm tắt thực trạng để dễ theo dõi tiến độ và phân biệt giữa phần đã hoàn thành và phần đang cần phát triển tiếp.
