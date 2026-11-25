# Sử dụng base image Node.js 22 phiên bản gọn nhẹ (Alpine)
FROM node:22-alpine

# Cài đặt thư viện openssl vì Prisma Query Engine cần nó để chạy trên Alpine Linux
RUN apk add --no-cache openssl

# Cài đặt thư mục làm việc mặc định trong container
WORKDIR /app

# Copy package descriptors và Prisma schema trước để tối ưu hóa Docker layer cache
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Cài đặt các thư viện (npm ci) và sinh Prisma Client trước khi copy mã nguồn
RUN npm ci && npx prisma generate

# Copy toàn bộ mã nguồn của dự án vào container (sẽ bỏ qua các file trong .dockerignore)
COPY . .

# Expose port mà Fastify server đang lắng nghe (mặc định PORT=5000)
EXPOSE 5000

# Health check định kỳ kiểm tra server hoạt động thông qua liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health/ping || exit 1

# Khởi chạy ứng dụng (chạy lệnh "node server.js" đã được định nghĩa trong package.json)
CMD ["npm", "start"]

