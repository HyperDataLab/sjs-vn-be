import * as storageController from '../controllers/storage.controller.js';
import { requireAuth } from '../../auth/middlewares/auth.middleware.js';
import {
  validateUploadRequest,
  validateDeleteRequest,
} from '../middlewares/storageValidation.middleware.js';

export default async function storageRoutes(fastify, options) {
  // Yêu cầu Signed URL để tải file trực tiếp lên Firebase Storage
  fastify.post('/upload-url', {
    preHandler: [requireAuth, validateUploadRequest],
  }, storageController.requestUploadUrl);

  // Xóa tệp tin trên Firebase Storage
  fastify.delete('/file', {
    preHandler: [requireAuth, validateDeleteRequest],
  }, storageController.deleteStorageFile);

  // Lấy Signed Read URL có thời hạn (nếu cần truy cập riêng tư)
  fastify.get('/read-url', {
    preHandler: [requireAuth],
  }, storageController.getReadUrl);

  // Lấy thông tin cấu hình công khai (MIME types, max file sizes, CDN base URL)
  fastify.get('/config', storageController.getStoragePublicConfig);
}
