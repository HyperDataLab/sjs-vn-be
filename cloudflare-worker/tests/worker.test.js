import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('Cloudflare Worker: Media CDN & Edge Cache Tests', async (t) => {
  const mockEnv = {
    FIREBASE_STORAGE_BUCKET: 'test-bucket.appspot.com',
    CACHE_TTL_SECONDS: '3600',
    ALLOWED_ORIGINS: '*',
  };
  const mockCtx = {
    waitUntil: () => {},
  };

  await t.test('handles CORS preflight OPTIONS request with 204', async () => {
    const request = new Request('https://cdn.example.com/articles/paper.pdf', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.ok(response.headers.get('Access-Control-Allow-Methods').includes('GET'));
  });

  await t.test('rejects POST and PUT methods with 405 Method Not Allowed', async () => {
    const request = new Request('https://cdn.example.com/articles/paper.pdf', {
      method: 'POST',
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 405);
    const body = await response.json();
    assert.equal(body.error, 'Method Not Allowed');
  });

  await t.test('returns health check status on /health endpoint', async () => {
    const request = new Request('https://cdn.example.com/health', {
      method: 'GET',
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'researchpulse-media-cdn');
    assert.equal(body.bucket, 'test-bucket.appspot.com');
  });

  await t.test('returns service info when accessing root path', async () => {
    const request = new Request('https://cdn.example.com/', {
      method: 'GET',
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.service, 'ResearchPulse Media CDN');
  });

  await t.test('blocks path traversal attempts with 400 Bad Request', async () => {
    const request = new Request('https://cdn.example.com/articles/%2e%2e/%2e%2e/etc/passwd', {
      method: 'GET',
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Bad Request');
  });

  await t.test('blocks unpermitted folders with 400 Bad Request', async () => {
    const request = new Request('https://cdn.example.com/unauthorized_folder/file.txt', {
      method: 'GET',
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Bad Request');
  });
});
