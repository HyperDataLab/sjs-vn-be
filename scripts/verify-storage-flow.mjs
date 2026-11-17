/**
 * Kịch bản kiểm thử End-to-End xác thực tính năng:
 * Firebase Storage + Cloudflare Worker Media CDN
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { mock } from 'node:test';
import assert from 'node:assert/strict';

// Cấu hình môi trường test
process.env.NODE_ENV = 'test';
process.env.VN_JWT_SECRET = 'test-child-secret-key-12345';
process.env.FIREBASE_STORAGE_BUCKET = 'scientificjournalsystem.appspot.com';
process.env.CLOUDFLARE_WORKER_URL = 'http://localhost:8787';

// Mock auth repository để giả lập người dùng hợp lệ
const mockUser = {
  user_id: 99,
  email: 'researcher@fpt.edu.vn',
  role: 'RESEARCHER',
  status: 'ACTIVE',
  type: 'AUTHOR',
};

// Import modules
const { authUserRepository } = await import('../src/modules/auth/middlewares/auth.middleware.js');
authUserRepository.findById = async () => mockUser;

const { signChildAccessToken } = await import('../src/modules/auth/config/authTokens.js');
const storageRoutes = (await import('../src/modules/storage/routes/storage.route.js')).default;
const worker = (await import('../cloudflare-worker/src/index.js')).default;

console.log('='.repeat(70));
console.log('🧪 BẮT ĐẦU KIỂM TRA TOÀN DIỆN HỆ THỐNG LƯU TRỮ & CLOUDFLARE WORKER');
console.log('='.repeat(70));

const runVerification = async () => {
  // 1. Khởi tạo Fastify Test Server
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(storageRoutes, { prefix: '/api/v1/storage' });
  await app.ready();

  const testToken = signChildAccessToken(mockUser);
  console.log('\n[BƯỚC 1] Khởi tạo Fastify Backend & Cấp phát Bearer Token thành công:');
  console.log(`  - User: ${mockUser.email} (ID: ${mockUser.user_id}, Role: ${mockUser.role})`);
  console.log(`  - Token Prefix: ${testToken.substring(0, 25)}...`);

  // 2. Kiểm tra GET /api/v1/storage/config
  console.log('\n[BƯỚC 2] Gọi API: GET /api/v1/storage/config (Lấy cấu hình công khai):');
  const configRes = await app.inject({
    method: 'GET',
    url: '/api/v1/storage/config',
  });

  assert.equal(configRes.statusCode, 200);
  const configBody = JSON.parse(configRes.payload);
  console.log(`  - HTTP Status: ${configRes.statusCode} OK`);
  console.log(`  - CDN Base URL: ${configBody.data.cdnBaseUrl}`);
  console.log(`  - Firebase Bucket: ${configBody.data.bucket}`);
  console.log(`  - Thư mục hỗ trợ: ${configBody.data.folders.join(', ')}`);
  console.log(`  - Giới hạn bài báo PDF: ${configBody.data.maxFileSizes.articles / (1024 * 1024)} MB`);

  // 3. Kiểm tra POST /api/v1/storage/upload-url
  console.log('\n[BƯỚC 3] Gọi API: POST /api/v1/storage/upload-url (Yêu cầu Signed Upload URL):');
  const uploadPayload = {
    folder: 'articles',
    fileName: 'Nghien_cuu_AI_Y_Te_2026.pdf',
    contentType: 'application/pdf',
    fileSize: 15 * 1024 * 1024, // 15MB
  };

  const uploadRes = await app.inject({
    method: 'POST',
    url: '/api/v1/storage/upload-url',
    headers: {
      authorization: `Bearer ${testToken}`,
      'content-type': 'application/json',
    },
    payload: uploadPayload,
  });

  assert.equal(uploadRes.statusCode, 200);
  const uploadBody = JSON.parse(uploadRes.payload);
  const { uploadUrl, cdnUrl, filePath } = uploadBody.data;

  console.log(`  - HTTP Status: ${uploadRes.statusCode} OK`);
  console.log(`  - File Path trong Firebase: ${filePath}`);
  console.log(`  - Signed Upload URL (Client upload thẳng): ${uploadUrl.substring(0, 75)}...`);
  console.log(`  - Public Cloudflare CDN URL (Dùng hiển thị): ${cdnUrl}`);

  // 4. Kiểm tra tính năng bảo vệ (Validation Defense)
  console.log('\n[BƯỚC 4] Kiểm tra cơ chế tự vệ (Validation):');
  const invalidRes = await app.inject({
    method: 'POST',
    url: '/api/v1/storage/upload-url',
    headers: {
      authorization: `Bearer ${testToken}`,
      'content-type': 'application/json',
    },
    payload: {
      folder: 'articles',
      fileName: 'virus.exe',
      contentType: 'application/x-msdownload', // Định dạng bị cấm
    },
  });
  console.log(`  - Thử tải file lạ (.exe): HTTP ${invalidRes.statusCode} [${JSON.parse(invalidRes.payload).code}] -> ĐÃ CHẶN THÀNH CÔNG`);
  assert.equal(invalidRes.statusCode, 400);

  // 5. Kiểm tra Cloudflare Worker CDN
  console.log('\n[BƯỚC 5] Kiểm tra trực tiếp Cloudflare Worker Media CDN:');
  const workerEnv = {
    FIREBASE_STORAGE_BUCKET: 'scientificjournalsystem.appspot.com',
    CACHE_TTL_SECONDS: '2592000',
    ALLOWED_ORIGINS: '*',
  };

  // 5.1 Health Check
  const healthReq = new Request('http://localhost:8787/health', { method: 'GET' });
  const healthRes = await worker.fetch(healthReq, workerEnv, { waitUntil: () => {} });
  console.log(`  - Health Check: HTTP ${healthRes.status} -> Service: ${(await healthRes.json()).service}`);
  assert.equal(healthRes.status, 200);

  // 5.2 CORS Preflight
  const corsReq = new Request(`http://localhost:8787/${filePath}`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173' },
  });
  const corsRes = await worker.fetch(corsReq, workerEnv, { waitUntil: () => {} });
  console.log(`  - CORS Preflight (OPTIONS): HTTP ${corsRes.status} -> Access-Control-Allow-Origin: ${corsRes.headers.get('Access-Control-Allow-Origin')}`);
  assert.equal(corsRes.status, 204);

  // 5.3 Chặn Path Traversal trên Worker
  const traversalReq = new Request('http://localhost:8787/articles/%2e%2e/%2e%2e/etc/passwd', { method: 'GET' });
  const traversalRes = await worker.fetch(traversalReq, workerEnv, { waitUntil: () => {} });
  console.log(`  - Tấn công Path Traversal (%2e%2e): HTTP ${traversalRes.status} -> ĐÃ CHẶN THÀNH CÔNG`);
  assert.equal(traversalRes.status, 400);

  console.log('\n' + '='.repeat(70));
  console.log('🎉 TẤT CẢ CÁC BƯỚC KIỂM THỬ ĐÃ HOÀN TẤT VÀ HOẠT ĐỘNG CHÍNH XÁC 100%!');
  console.log('='.repeat(70));
};

runVerification().catch((err) => {
  console.error('❌ Lỗi kiểm tra:', err);
  process.exit(1);
});
