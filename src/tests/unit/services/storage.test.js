import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFileName,
  validateUploadRequest,
  validateDeleteRequest,
  STORAGE_FOLDERS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZES,
} from '../../../modules/storage/middlewares/storageValidation.middleware.js';
import {
  createSignedUploadUrl,
  createSignedReadUrl,
  getStorageConfig,
} from '../../../modules/storage/services/storage.service.js';
import * as storageController from '../../../modules/storage/controllers/storage.controller.js';

test('Storage Module: Unit Tests', async (t) => {
  await t.test('sanitizeFileName removes path traversal and dangerous characters', () => {
    assert.equal(sanitizeFileName('../../paper.pdf'), 'paper.pdf');
    assert.equal(sanitizeFileName('..\\..\\malicious.exe'), 'malicious.exe');
    assert.equal(sanitizeFileName('my paper (draft) #1.pdf'), 'my_paper__draft___1.pdf');
    assert.equal(sanitizeFileName(''), 'file');
    assert.equal(sanitizeFileName(null), 'file');
  });

  await t.test('validateUploadRequest rejects invalid or missing folder', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    const req = {
      body: {
        folder: 'invalid_folder',
        fileName: 'test.pdf',
        contentType: 'application/pdf',
      },
    };

    await validateUploadRequest(req, mockReply);
    assert.equal(mockReply.statusCode, 400);
    assert.equal(mockReply.payload.code, 'INVALID_STORAGE_FOLDER');
  });

  await t.test('validateUploadRequest rejects unsupported MIME type for folder', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    // Thư mục articles chỉ chấp nhận application/pdf, không chấp nhận image/png
    const req = {
      body: {
        folder: STORAGE_FOLDERS.ARTICLES,
        fileName: 'image.png',
        contentType: 'image/png',
      },
    };

    await validateUploadRequest(req, mockReply);
    assert.equal(mockReply.statusCode, 400);
    assert.equal(mockReply.payload.code, 'UNSUPPORTED_CONTENT_TYPE');
  });

  await t.test('validateUploadRequest rejects file size exceeding maximum limit', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    // Avatars tối đa 5MB. Gửi 10MB -> Bị từ chối
    const req = {
      body: {
        folder: STORAGE_FOLDERS.AVATARS,
        fileName: 'avatar.png',
        contentType: 'image/png',
        fileSize: 10 * 1024 * 1024,
      },
    };

    await validateUploadRequest(req, mockReply);
    assert.equal(mockReply.statusCode, 400);
    assert.equal(mockReply.payload.code, 'FILE_SIZE_EXCEEDED');
  });

  await t.test('validateUploadRequest accepts valid upload parameters and attaches storageParams', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    const req = {
      body: {
        folder: STORAGE_FOLDERS.ARTICLES,
        fileName: 'research_paper.pdf',
        contentType: 'application/pdf',
        fileSize: 1024 * 1024, // 1MB
      },
    };

    await validateUploadRequest(req, mockReply);
    assert.equal(mockReply.statusCode, null);
    assert.ok(req.storageParams);
    assert.equal(req.storageParams.folder, 'articles');
    assert.equal(req.storageParams.fileName, 'research_paper.pdf');
    assert.equal(req.storageParams.contentType, 'application/pdf');
  });

  await t.test('validateDeleteRequest blocks directory traversal and invalid folders', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    const reqTraversal = { body: { filePath: '../articles/secret.pdf' } };
    await validateDeleteRequest(reqTraversal, mockReply);
    assert.equal(mockReply.statusCode, 400);
    assert.equal(mockReply.payload.code, 'INVALID_FILE_PATH');

    const reqInvalidFolder = { body: { filePath: 'system_files/secret.pdf' } };
    await validateDeleteRequest(reqInvalidFolder, mockReply);
    assert.equal(mockReply.statusCode, 400);
    assert.equal(mockReply.payload.code, 'INVALID_FILE_PATH_FOLDER');
  });

  await t.test('createSignedUploadUrl generates proper uploadUrl and Cloudflare CDN URL', async () => {
    const result = await createSignedUploadUrl({
      folder: STORAGE_FOLDERS.ARTICLES,
      fileName: 'nature_paper.pdf',
      contentType: 'application/pdf',
      userId: 42,
    });

    assert.ok(result.uploadUrl);
    assert.ok(result.cdnUrl);
    assert.ok(result.filePath);
    assert.ok(result.filePath.startsWith('articles/u42_'));
    assert.ok(result.filePath.endsWith('_nature_paper.pdf'));
    assert.ok(result.cdnUrl.includes('/articles/u42_'));
    assert.equal(result.folder, 'articles');
    assert.equal(result.contentType, 'application/pdf');
    assert.equal(result.expiresInSeconds, 900);
  });

  await t.test('getStorageConfig returns valid configuration object', () => {
    const config = getStorageConfig();
    assert.ok(config.cdnBaseUrl);
    assert.ok(config.bucket);
    assert.deepEqual(config.folders, ['articles', 'avatars', 'reports']);
    assert.ok(config.allowedMimeTypes.articles.includes('application/pdf'));
    assert.equal(config.maxFileSizes.articles, 50 * 1024 * 1024);
  });

  await t.test('storageController.getStoragePublicConfig returns 200 with config payload', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    await storageController.getStoragePublicConfig({}, mockReply);
    assert.equal(mockReply.statusCode, 200);
    assert.equal(mockReply.payload.success, true);
    assert.ok(mockReply.payload.data.cdnBaseUrl);
  });

  await t.test('storageController.requestUploadUrl returns 200 with generated URLs', async () => {
    const mockReply = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(data) {
        this.payload = data;
        return this;
      },
    };

    const mockRequest = {
      storageParams: {
        folder: STORAGE_FOLDERS.AVATARS,
        fileName: 'avatar.png',
        contentType: 'image/png',
      },
      user: { user_id: 10, role: 'USER' },
      ip: '127.0.0.1',
    };

    await storageController.requestUploadUrl(mockRequest, mockReply);
    assert.equal(mockReply.statusCode, 200);
    assert.equal(mockReply.payload.success, true);
    assert.ok(mockReply.payload.data.uploadUrl);
    assert.ok(mockReply.payload.data.cdnUrl);
  });
});
