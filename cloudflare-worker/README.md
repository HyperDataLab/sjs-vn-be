# 🌐 Cloudflare Worker: ResearchPulse Media CDN & Edge Cache

Tầng phân phối nội dung tĩnh và bộ nhớ đệm biên (**Edge Cache Shield**) đặt phía trước **Firebase Storage** cho dự án ResearchPulse.

---

## 🎯 Mục tiêu Kiến trúc

1. **Triệt tiêu phí Egress**: Toàn bộ lượt đọc/tải PDF bài báo và hình ảnh sau lần tải đầu tiên đều được phục vụ trực tiếp từ Cloudflare Edge Cache (`X-Edge-Cache: HIT`), không gọi về Firebase Storage.
2. **Tăng tốc độ tải tại Việt Nam**: Các PoP (Point of Presence) của Cloudflare tại VN phục vụ file với độ trễ tối thiểu.
3. **Mở PDF trực tiếp trên trình duyệt**: Tự động cấu hình `Content-Disposition: inline` và hỗ trợ `Range Requests (HTTP 206)` để streaming PDF mượt mà.
4. **Custom Domain**: Ẩn link gốc dài của Google/Firebase, phục vụ qua domain chuẩn (ví dụ `cdn.researchpulse.vn`).

---

## 🛠️ Cấu trúc Thư mục

```text
cloudflare-worker/
├── package.json         # Scripts chạy dev & deploy
├── wrangler.toml        # Cấu hình worker & biến môi trường Cloudflare
├── README.md            # Tài liệu hướng dẫn
├── src/
│   └── index.js         # Mã nguồn xử lý Cache API, Proxy & Headers
└── tests/
    └── worker.test.js   # Bộ kiểm thử đơn vị mô phỏng
```

---

## 🚀 Hướng dẫn Chạy thử & Triển khai

### 1. Cài đặt Dependencies

```bash
cd cloudflare-worker
npm install
```

### 2. Chạy thử nghiệm Local (Wrangler Dev)

```bash
npm run dev
# Hoặc: npx wrangler dev --port 8787
```

Kiểm tra sức khỏe worker:
```bash
curl http://localhost:8787/health
```

### 3. Đăng nhập Cloudflare & Triển khai (Deploy)

1. Đăng nhập vào tài khoản Cloudflare qua CLI:
   ```bash
   npx wrangler login
   ```

2. Kiểm tra tên Bucket trong file `wrangler.toml`:
   ```toml
   [vars]
   FIREBASE_STORAGE_BUCKET = "scientificjournalsystem.appspot.com"
   CACHE_TTL_SECONDS = "2592000" # 30 ngày
   ALLOWED_ORIGINS = "*"
   ```

3. Deploy lên Cloudflare Global Edge:
   ```bash
   npm run deploy
   # Hoặc: npx wrangler deploy
   ```

### 4. Gắn Custom Domain (Khuyên dùng)

Trên **Cloudflare Dashboard**:
1. Vào mục **Workers & Pages** -> Chọn Worker `researchpulse-media-cdn`.
2. Vào tab **Settings** -> **Domains & Routes** -> Chọn **Add Custom Domain**.
3. Nhập domain mong muốn: ví dụ `cdn.researchpulse.vn`.
4. Cập nhật biến môi trường trên Fastify Backend (`sjs-vn-be/.env`):
   ```env
   CLOUDFLARE_WORKER_URL=https://cdn.researchpulse.vn
   ```

---

## 📡 Luồng Truy cập File

```text
User/Browser ──► https://cdn.researchpulse.vn/articles/u1_17000000_paper.pdf
                       │
                       ├─ (1) Cloudflare Edge Cache: HIT ──► Trả về file ngay lập tức (0 latency, 0 fee)
                       │
                       └─ (2) Cloudflare Edge Cache: MISS ──► Fetch từ Firebase Storage Bucket ──► Lưu Cache ──► Trả về Client
```
