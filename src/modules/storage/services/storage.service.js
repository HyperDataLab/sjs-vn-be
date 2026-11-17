import crypto from 'crypto';
import {
  getFirebaseBucket,
  getStorageBucketName,
  getCloudflareWorkerUrl,
  isStorageMock,
} from '../config/firebase.js';
import {
  STORAGE_FOLDERS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZES,
} from '../middlewares/storageValidation.middleware.js';
import logger from '../../../utils/logger.js';

/**
 * Tạo Signed URL để client upload trực tiếp lên Firebase Storage
 * kèm đường dẫn CDN qua Cloudflare Worker.
 */
export const createSignedUploadUrl = async ({
  folder,
  fileName,
  contentType,
  userId = null,
  expiresInSeconds = parseInt(process.env.STORAGE_UPLOAD_EXPIRES_SECONDS, 10) || 900,
}) => {
  const bucket = getFirebaseBucket();
  const bucketName = getStorageBucketName();
  const workerCdnBase = getCloudflareWorkerUrl();

  const timestamp = Date.now();
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  const userPrefix = userId ? `u${userId}_` : '';
  const uniqueKey = `${userPrefix}${timestamp}_${randomSuffix}_${fileName}`;
  const filePath = `${folder}/${uniqueKey}`;

  const file = bucket.file(filePath);

  let uploadUrl;
  try {
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInSeconds * 1000,
      contentType,
    });
    uploadUrl = signedUrl;
  } catch (error) {
    logger.error(`Error generating signed upload URL: ${error.message}`);
    // Fallback nếu đang ở chế độ mock
    uploadUrl = `https://storage.googleapis.com/${bucketName}/${filePath}?upload_token=${crypto.randomUUID()}`;
  }

  // Đường dẫn phục vụ qua Cloudflare Worker Edge CDN
  const cdnUrl = `${workerCdnBase}/${filePath}`;
  // Đường dẫn gốc trực tiếp từ Firebase Storage (để tham chiếu hoặc fallback)
  const originUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media`;

  return {
    uploadUrl,
    cdnUrl,
    originUrl,
    filePath,
    bucket: bucketName,
    folder,
    contentType,
    expiresInSeconds,
    isMock: isStorageMock(),
  };
};

/**
 * Tạo Signed Read URL có thời hạn để đọc file riêng tư nếu cần
 */
export const createSignedReadUrl = async ({
  filePath,
  expiresInSeconds = parseInt(process.env.STORAGE_READ_EXPIRES_SECONDS, 10) || 3600,
}) => {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);

  try {
    const [readUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });
    return {
      readUrl,
      filePath,
      expiresInSeconds,
    };
  } catch (error) {
    logger.error(`Error generating signed read URL: ${error.message}`);
    const workerCdnBase = getCloudflareWorkerUrl();
    return {
      readUrl: `${workerCdnBase}/${filePath}`,
      filePath,
      expiresInSeconds,
      fallback: true,
    };
  }
};

/**
 * Xóa tệp tin trên Firebase Storage
 */
export const deleteFileFromStorage = async (filePath) => {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);

  try {
    await file.delete({ ignoreNotFound: true });
    logger.info(`Storage file deleted successfully: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    logger.error(`Error deleting file from storage: ${error.message}`);
    throw error;
  }
};

/**
 * Kiểm tra xem tệp tin có tồn tại trong bucket không
 */
export const checkFileExistsInStorage = async (filePath) => {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);

  try {
    const [exists] = await file.exists();
    return exists;
  } catch (error) {
    logger.warn(`Error checking file existence for ${filePath}: ${error.message}`);
    return false;
  }
};

/**
 * Lấy cấu hình công khai của hệ thống lưu trữ
 */
export const getStorageConfig = () => {
  const workerCdnBase = getCloudflareWorkerUrl();
  const bucketName = getStorageBucketName();

  return {
    cdnBaseUrl: workerCdnBase,
    bucket: bucketName,
    folders: Object.values(STORAGE_FOLDERS),
    allowedMimeTypes: ALLOWED_MIME_TYPES,
    maxFileSizes: MAX_FILE_SIZES,
    isMock: isStorageMock(),
  };
};
