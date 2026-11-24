# Production Deployment Runbook & Operational Guide

## 1. Kiến trúc hệ thống trên Production
Hệ thống ResearchPulse Vietnam bao gồm 2 thành phần chính chạy trên môi trường Container (Docker):
- **API Gateway & Fastify Server (`vietnam-backend`)**: Xử lý toàn bộ RESTful API, xác thực SSO, tra cứu xu hướng và phân tích bài báo.
- **Background Worker (`vietnam-worker`)**: Tiến trình nền độc lập chạy BullMQ Worker để cào dữ liệu ORCID và đồng bộ định danh tác giả mà không làm nghẽn Event Loop của API.
- **Frontend SPA (`vietnam-frontend`)**: Ứng dụng Vite React được tối ưu hoá qua Nginx container với HTTP Security Headers và cache vĩnh viễn cho assets.

---

## 2. Yêu cầu môi trường (Prerequisites)
- **Docker Engine**: Phiên bản 24.0 trở lên.
- **Docker Compose**: Phiên bản v2 trở lên (`docker compose` hoặc `docker-compose`).
- **PostgreSQL**: Phiên bản 16 với extension `pgvector` (để hỗ trợ vector search).
- **Redis**: Phiên bản 7.x (dùng cho BullMQ Queue và bộ đệm 2 tầng).
- **External Network**: Docker network `researchpulse_network` phải được tạo trước:
  ```bash
  docker network create researchpulse_network || true
  ```

---

## 3. Cấu hình biến môi trường Production
Tạo file `.env` tại thư mục chứa `docker-compose.yml`:
```ini
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://vn.hyperdatalab.org

# Kết nối cơ sở dữ liệu & Redis
DATABASE_URL=postgresql://<db_user>:<db_password>@<db_host>:5432/<db_name>?schema=public
POSTGRES_URL=postgresql://<db_user>:<db_password>@<db_host>:5432/<db_name>?schema=public
REDIS_URL=redis://<redis_host>:6379

# JWT Secrets (Bắt buộc phải thay đổi bằng chuỗi ngẫu nhiên có độ dài tối thiểu 32 ký tự)
VN_JWT_SECRET=production_random_secret_string_here_32chars
VN_JWT_REFRESH_SECRET=production_random_refresh_secret_string_here_32chars

# Central SSO Integration
CENTRAL_SSO_API_URL=https://sso-api.hyperdatalab.org
CENTRAL_SSO_ISSUER_URL=https://sso.hyperdatalab.org
CENTRAL_SSO_TIMEOUT_MS=5000
SSO_CLIENT_ID=vietnam-app
SSO_REDIRECT_URI=https://vn.hyperdatalab.org/auth/callback
```

---

## 4. Các bước triển khai (Deploy Instructions)

### Bước 1: Kéo Image mới nhất từ GHCR
```bash
docker compose pull vietnam-backend vietnam-worker
```

### Bước 2: Chạy Database Migration (nếu có migration mới)
```bash
docker run --rm --network researchpulse_network \
  --env-file .env \
  ghcr.io/researchpulse/scientificjournalsystem-vietnam-be:latest \
  npx prisma migrate deploy
```

### Bước 3: Tái khởi động Service không gián đoạn
```bash
docker compose up -d --force-recreate --no-deps vietnam-backend vietnam-worker
```

### Bước 4: Kiểm tra trạng thái Container
```bash
docker compose ps
```

---

## 5. Giám sát & Health Check Endpoints
- **Liveness Ping**: `GET http://localhost:5000/health/ping` ➔ Trả về `{ "pong": true, "time": ... }` (dùng cho Docker healthcheck).
- **Full Database & Memory Health**: `GET http://localhost:5000/api/v1/health` ➔ Trả về chi tiết kết nối `postgresPool`, `prismaClient`, RAM heap usage và uptime.
- **Frontend Health**: `GET http://localhost:8083/healthz` ➔ Trả về HTTP 200 `healthy`.

---

## 6. Tra cứu Logs & Xử lý sự cố
- Xem log API Server:
  ```bash
  docker compose logs -f vietnam-backend
  ```
- Xem log Worker ORCID:
  ```bash
  docker compose logs -f vietnam-worker
  ```
- Tra cứu theo Request ID: Fastify đính kèm header `x-request-id` trong mọi HTTP response. Bạn có thể grep mã này trong log để truy vết chính xác chuỗi xử lý của request gặp lỗi:
  ```bash
  docker compose logs vietnam-backend | grep "reqId\":\"<ID_FROM_HEADER>"
  ```
