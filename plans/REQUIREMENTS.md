# 💰 Tổng quan dự án: Web Quản lý Chi tiêu

(Bản sao của REQUIREMENTS.md để phục vụ kế hoạch triển khai)

Hãy tưởng tượng dự án này là một cuốn sổ tay thu chi điện tử cá nhân. Mục tiêu chính là xây dựng một trang web cho phép người dùng theo dõi chính xác tiền của họ đang đi đâu. Thay vì ghi chép bằng tay, người dùng sẽ đăng nhập vào web này để ghi lại các khoản thu nhập (như lương, tiền thưởng) và các khoản chi tiêu (như ăn uống, đi lại, mua sắm). Từ đó, trang web sẽ tự động tính toán và cho người dùng biết tổng số tiền họ đang có, tháng này họ đã tiêu bao nhiêu, và tiền đã tiêu vào những việc gì.

## 🧑 Yêu cầu về Người dùng (Ai sẽ dùng?)

Hệ thống chỉ có một loại người dùng chính:
* **Người dùng cá nhân**: Bất kỳ ai muốn quản lý tài chính cá nhân của mình, theo dõi thu nhập và chi tiêu.

## ✨ Yêu cầu về Chức năng (Web này phải làm được gì?)

Đây là những chức năng cụ thể mà người dùng có thể thực hiện trên trang web:

### 1. Đăng nhập và Tài khoản
* **Đăng nhập bằng Google**: Người dùng không cần phải tạo tài khoản hay nhớ mật khẩu mới. Họ chỉ cần sử dụng tài khoản Google có sẵn của mình để đăng nhập.
* **Tự động tạo tài khoản**: Nếu là lần đầu đăng nhập bằng Google, hệ thống sẽ tự động tạo một tài khoản mới cho họ.
* **Bảo mật**: Người dùng chỉ có thể xem và quản lý dữ liệu tài chính của chính mình. Họ không thể thấy dữ liệu của bất kỳ ai khác.

### 2. Quản lý "Ví" (Tài khoản ngân hàng)
* **Khởi tạo "Ví" đầu tiên**: Ngay sau khi đăng nhập lần đầu, hệ thống phải yêu cầu người dùng tạo ít nhất một "ví" (tài khoản ngân hàng) để bắt đầu sử dụng.
* **Thêm nhiều "Ví"**: Người dùng có thể tạo nhiều ví khác nhau để quản lý. Ví dụ: "Ví Tiền mặt", "Tài khoản Vietcombank", "Tài khoản Techcombank".
* **Nhập thông tin cho Ví**: Khi tạo một ví mới, người dùng phải cung cấp:
  * Tên ngân hàng (hoặc tên ví, ví dụ: "Tiền mặt").
  * Số tài khoản (nếu có).
  * Số dư ban đầu: Số tiền hiện có trong tài khoản đó tại thời điểm Ngày bắt đầu tính toán cho ví này.
  * Ngày tạo: Ngày bắt đầu tính toán cho ví này.
* **Xem tổng số dư**: Trang chủ phải hiển thị tổng số tiền mà người dùng có, bằng cách cộng tất cả số dư từ các ví lại tại thời điểm hiện tại.

### 3. Ghi chép Giao dịch (Thu/Chi)
* Giao dịch có thể chỉnh sửa: số tiền, loại (thu/chi), và ngày.
* **Thêm khoản "Thu" (Tiền vào)**:
  * Người dùng có thể ghi lại một khoản thu nhập mới (ví dụ: nhận lương).
  * Khi thêm, họ phải chọn:
    1. Số tiền đã nhận.
    2. Thu vào "ví" nào (ví dụ: "Tài khoản Vietcombank").
    3. Thuộc danh mục nào (ví dụ: "Lương", "Thưởng", "Thu nhập khác").
    4. Ngày nhận tiền.
    5. Ghi chú (ví dụ: "Lương tháng 10").
* **Thêm khoản "Chi" (Tiền ra)**:
  * Người dùng có thể ghi lại một khoản chi tiêu (ví dụ: ăn trưa).
  * Khi thêm, họ phải chọn:
    1. Số tiền đã tiêu.
    2. Chi từ "ví" nào (ví dụ: "Ví Tiền mặt").
    3. Thuộc danh mục nào (ví dụ: "Ăn uống", "Đi lại", "Mua sắm").
    4. Ngày chi tiền.
    5. Ghi chú (ví dụ: "Ăn trưa với đồng nghiệp").
* **Tự động cập nhật số dư**: Sau khi người dùng thêm một khoản thu hoặc chi, hệ hệ thống phải tự động tính toán lại số dư của ví đó.
  * *Ví dụ: Ví Vietcombank có 10.000.000. Thêm khoản chi "Ăn uống" 50.000. Số dư mới của ví tự động cập nhật còn 9.950.000.*
* **Kiểm tra số dư**: Hệ thống không cho phép người dùng tạo một khoản chi tiêu lớn hơn số tiền họ có trong ví.

### 4. Báo cáo và Lịch sử
* **Xem Lịch sử Giao dịch**:
  * Hiển thị một danh sách tất cả các khoản thu/chi mà người dùng đã ghi lại.
  * Danh sách này phải được sắp xếp theo thời gian, từ mới nhất đến cũ nhất.
  * Mỗi dòng trong danh sách phải hiển thị rõ: là khoản thu hay chi, ngày tháng, nội dung thu hay chi, số tiền đầu kỳ, số tiền thu/chi, số tiền cuối kỳ, note/ghi chú.
* **Xem "Sao kê" (Báo cáo chi tiết)**:
  * Đây là chức năng báo cáo nâng cao.
  * Người dùng có thể lọc báo cáo bằng cách chọn:
    1. Một "ví" cụ thể (ví dụ: chỉ xem sao kê của "Tài khoản Vietcombank").
    2. Một khoảng thời gian (ví dụ: "Từ ngày 1/10" đến "Ngày 31/10").
  * Sau khi lọc, hệ thống phải hiển thị một bản báo cáo tổng hợp bao gồm:
    1. Số dư đầu kỳ: Số tiền có vào ngày bắt đầu (ví dụ: ngày 1/10).
    2. Tổng thu trong kỳ: Tổng tất cả các khoản thu trong khoảng thời gian đã chọn.
    3. Tổng chi trong kỳ: Tổng tất cả các khoản chi trong khoảng thời gian đã chọn.
    4. Số dư cuối kỳ: Số tiền còn lại vào ngày kết thúc (ví dụ: ngày 31/10).
  * Bên dưới phần tổng hợp là danh sách chi tiết từng giao dịch đã xảy ra trong kỳ đó.

## 📱 Yêu cầu Phi chức năng (Web này phải như thế nào?)

Đây là những yêu cầu không phải về tính năng, mà về trải nghiệm và chất lượng của web:
* **Dễ sử dụng**: Giao diện phải đơn giản, sạch sẽ, và trực quan. Người dùng không cần đọc hướng dẫn cũng phải tự biết cách thêm khoản thu/chi.
* **Tương thích đa thiết bị (Responsive)**: Trang web phải tự động co dãn và hiển thị đẹp mắt, dễ thao tác trên cả máy tính (màn hình lớn) và điện thoại di động (màn hình nhỏ).
* **Phản hồi nhanh**: Khi người dùng bấm nút, hệ thống phải phản hồi ngay lập tức, không bị "đơ" hay "lag".
* **Dễ bảo trì (Về phía lập trình)**: Code phải được tổ chức gọn gàng, chia thành 2 phần rõ rệt:
  1. Client (Giao diện): Phần mà người dùng nhìn thấy.
  2. Server (Bộ não): Phần máy chủ ở đằng sau để xử lý tính toán và lưu trữ dữ liệu.
* **Dễ triển khai (Về phía lập trình)**: Toàn bộ dự án phải được "đóng gói" bằng Docker. Điều này có nghĩa là lập trình viên chỉ cần chạy một lệnh là cả "Giao diện", "Bộ não" và "Cơ sở dữ liệu" đều tự động chạy cùng nhau một cách chính xác.

## 🛠 Công nghệ (Giải thích đơn giản)

Để làm được những điều trên, dự án sử dụng các công nghệ sau:
* **Phần Giao diện (Client)**: Dùng React (với TypeScript). Giúp giao diện web chạy rất nhanh và mượt mà, giống như dùng một ứng dụng.
* **Phần Bộ não (Server)**: Dùng Node.js (với Express.js) code TypeScript. Đây là "bộ não" nhận yêu cầu từ người dùng (ví dụ: "thêm 1 khoản chi 50.000"), xử lý logic (trừ 50.000 khỏi ví), và lưu kết quả.
* **Nơi lưu trữ (Database)**: Dùng MongoDB. Đây là "tủ hồ sơ" để lưu trữ mọi thứ: thông tin người dùng, danh sách các ví, và chi tiết từng giao dịch thu/chi.
* **Việc đóng gói (Containerization)**: Dùng Docker và Docker Compose để "đóng gói" cả 3 phần trên vào các "thùng chứa" tiêu chuẩn, giúp dự án có thể chạy được ngay trên máy mới chỉ với một lệnh, đồng thời đảm bảo mọi môi trường đều có cấu hình tương đồng và không phụ thuộc vào máy cài đặt cục bộ.

## 💪 NÂNG CAO
* Xử lý được với 1 user có 100 tài khoản NH, mỗi tài khoản có hàng triệu giao dịch.
* Xuất báo cáo ra file PDF và Excel, báo cáo đáp ứng được hàng triệu dòng dữ liệu.
* Thiết kế được kiến trúc multi-tenant cho web app này để có thể đáp ứng được hàng triệu request trong 1 phút.

