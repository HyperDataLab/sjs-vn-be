import * as storageService from '../services/storage.service.js';
import logger from '../../../utils/logger.js';
import { createLog } from '../../system/services/log.service.js';

/**
 * Tạo Signed Upload URL cho client tải file lên Firebase Storage
 * POST /api/v1/storage/upload-url
 */
export const requestUploadUrl = async (request, reply) => {
  try {
    const { folder, fileName, contentType, fileSize } = request.storageParams;
    const userId = request.user?.user_id;

    const result = await storageService.createSignedUploadUrl({
      folder,
      fileName,
      contentType,
      userId,
    });

    if (userId) {
      await createLog({
        userId,
        userRole: request.user?.role || 'USER',
        action: 'CREATE',
        message: `Yêu cầu upload URL cho ${folder}/${fileName} (${contentType})`,
        metadata: {
          endpoint: '/api/v1/storage/upload-url',
          method: 'POST',
          folder,
          fileName,
          ip: request.ip,
        },
      }).catch((logErr) => logger.warn(`Log storage upload failed: ${logErr.message}`));
    }

    return reply.status(200).send({
      success: true,
      message: 'Tạo signed upload URL thành công',
      data: result,
    });
  } catch (error) {
    logger.error(`Error in requestUploadUrl controller: ${error.message}`);
    return reply.status(500).send({
      success: false,
      code: 'STORAGE_UPLOAD_URL_ERROR',
      message: 'Không thể tạo signed upload URL: ' + error.message,
    });
  }
};

/**
 * Xóa file trong Firebase Storage
 * DELETE /api/v1/storage/file
 */
export const deleteStorageFile = async (request, reply) => {
  try {
    const filePath = request.validatedFilePath;
    const userId = request.user?.user_id;

    const result = await storageService.deleteFileFromStorage(filePath);

    if (userId) {
      await createLog({
        userId,
        userRole: request.user?.role || 'USER',
        action: 'DELETE',
        message: `Xóa tệp lưu trữ: ${filePath}`,
        metadata: {
          endpoint: '/api/v1/storage/file',
          method: 'DELETE',
          filePath,
          ip: request.ip,
        },
      }).catch((logErr) => logger.warn(`Log storage delete failed: ${logErr.message}`));
    }

    return reply.status(200).send({
      success: true,
      message: 'Đã xóa tệp tin thành công',
      data: result,
    });
  } catch (error) {
    logger.error(`Error in deleteStorageFile controller: ${error.message}`);
    return reply.status(500).send({
      success: false,
      code: 'STORAGE_DELETE_ERROR',
      message: 'Không thể xóa tệp tin: ' + error.message,
    });
  }
};

/**
 * Lấy Signed Read URL cho file
 * GET /api/v1/storage/read-url
 */
export const getReadUrl = async (request, reply) => {
  try {
    const filePath = request.query?.filePath;
    if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
      return reply.status(400).send({
        success: false,
        code: 'FILE_PATH_REQUIRED',
        message: 'Query parameter "filePath" không được để trống',
      });
    }

    if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_FILE_PATH',
        message: 'Đường dẫn tệp không hợp lệ',
      });
    }

    const expiresInSeconds = request.query.expiresInSeconds
      ? parseInt(request.query.expiresInSeconds, 10)
      : 3600;

    const result = await storageService.createSignedReadUrl({
      filePath: filePath.trim(),
      expiresInSeconds: isNaN(expiresInSeconds) ? 3600 : expiresInSeconds,
    });

    return reply.status(200).send({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Error in getReadUrl controller: ${error.message}`);
    return reply.status(500).send({
      success: false,
      code: 'STORAGE_READ_URL_ERROR',
      message: 'Không thể tạo signed read URL: ' + error.message,
    });
  }
};

/**
 * Lấy cấu hình công khai của dịch vụ lưu trữ
 * GET /api/v1/storage/config
 */
export const getStoragePublicConfig = async (_request, reply) => {
  try {
    const config = storageService.getStorageConfig();
    return reply.status(200).send({
      success: true,
      data: config,
    });
  } catch (error) {
    logger.error(`Error in getStoragePublicConfig controller: ${error.message}`);
    return reply.status(500).send({
      success: false,
      code: 'STORAGE_CONFIG_ERROR',
      message: 'Không thể lấy cấu hình lưu trữ: ' + error.message,
    });
  }
};
