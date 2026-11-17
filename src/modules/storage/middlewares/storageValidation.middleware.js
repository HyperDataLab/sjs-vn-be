import path from 'path';

export const STORAGE_FOLDERS = {
  ARTICLES: 'articles',
  AVATARS: 'avatars',
  REPORTS: 'reports',
};

export const ALLOWED_MIME_TYPES = {
  [STORAGE_FOLDERS.ARTICLES]: [
    'application/pdf',
  ],
  [STORAGE_FOLDERS.AVATARS]: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ],
  [STORAGE_FOLDERS.REPORTS]: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/pdf',
    'application/json',
  ],
};

export const MAX_FILE_SIZES = {
  [STORAGE_FOLDERS.ARTICLES]: parseInt(process.env.STORAGE_MAX_ARTICLE_SIZE_BYTES, 10) || 50 * 1024 * 1024, // 50MB
  [STORAGE_FOLDERS.AVATARS]: parseInt(process.env.STORAGE_MAX_AVATAR_SIZE_BYTES, 10) || 5 * 1024 * 1024,   // 5MB
  [STORAGE_FOLDERS.REPORTS]: parseInt(process.env.STORAGE_MAX_REPORT_SIZE_BYTES, 10) || 25 * 1024 * 1024,  // 25MB
};

export const sanitizeFileName = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return 'file';
  // Loại bỏ các ký tự điều khiển, dấu phân cách đường dẫn và traversal
  const base = path.basename(fileName).trim();
  // Giữ lại các ký tự an toàn: chữ, số, dấu gạch nối, dấu chấm, gạch dưới
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'file';
};

export const validateUploadRequest = async (request, reply) => {
  const body = request.body || {};
  const { fileName, contentType, folder, fileSize } = body;

  if (!folder || !Object.values(STORAGE_FOLDERS).includes(folder)) {
    return reply.status(400).send({
      success: false,
      code: 'INVALID_STORAGE_FOLDER',
      message: `Thư mục lưu trữ không hợp lệ. Cho phép: ${Object.values(STORAGE_FOLDERS).join(', ')}`,
    });
  }

  if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
    return reply.status(400).send({
      success: false,
      code: 'FILE_NAME_REQUIRED',
      message: 'Tên tệp không được để trống',
    });
  }

  if (!contentType || typeof contentType !== 'string' || !contentType.trim()) {
    return reply.status(400).send({
      success: false,
      code: 'CONTENT_TYPE_REQUIRED',
      message: 'Định dạng contentType không được để trống',
    });
  }

  const allowedTypes = ALLOWED_MIME_TYPES[folder] || [];
  const normalizedContentType = contentType.toLowerCase().trim();

  if (!allowedTypes.includes(normalizedContentType)) {
    return reply.status(400).send({
      success: false,
      code: 'UNSUPPORTED_CONTENT_TYPE',
      message: `Định dạng ${contentType} không được hỗ trợ cho thư mục ${folder}. Cho phép: ${allowedTypes.join(', ')}`,
    });
  }

  const maxSize = MAX_FILE_SIZES[folder];
  if (fileSize !== undefined) {
    const sizeNumber = Number(fileSize);
    if (isNaN(sizeNumber) || sizeNumber <= 0) {
      return reply.status(400).send({
        success: false,
        code: 'INVALID_FILE_SIZE',
        message: 'Dung lượng tệp không hợp lệ',
      });
    }
    if (sizeNumber > maxSize) {
      return reply.status(400).send({
        success: false,
        code: 'FILE_SIZE_EXCEEDED',
        message: `Dung lượng tệp vượt quá giới hạn tối đa (${Math.round(maxSize / (1024 * 1024))}MB)`,
      });
    }
  }

  request.storageParams = {
    folder,
    fileName: sanitizeFileName(fileName),
    contentType: normalizedContentType,
    fileSize: fileSize ? Number(fileSize) : undefined,
  };
};

export const validateDeleteRequest = async (request, reply) => {
  const body = request.body || {};
  const { filePath } = body;

  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    return reply.status(400).send({
      success: false,
      code: 'FILE_PATH_REQUIRED',
      message: 'Đường dẫn tệp (filePath) không được để trống',
    });
  }

  // Chặn path traversal
  if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) {
    return reply.status(400).send({
      success: false,
      code: 'INVALID_FILE_PATH',
      message: 'Đường dẫn tệp không hợp lệ hoặc có dấu hiệu bất thường',
    });
  }

  const parts = filePath.split('/');
  const targetFolder = parts[0];
  if (!Object.values(STORAGE_FOLDERS).includes(targetFolder)) {
    return reply.status(400).send({
      success: false,
      code: 'INVALID_FILE_PATH_FOLDER',
      message: `Thư mục của tệp không nằm trong phạm vi quản lý: ${Object.values(STORAGE_FOLDERS).join(', ')}`,
    });
  }

  request.validatedFilePath = filePath.trim();
};
