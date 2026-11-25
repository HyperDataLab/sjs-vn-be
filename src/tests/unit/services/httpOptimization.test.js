import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import {
  getCompressionConfig,
  getRateLimitConfig,
  isRateLimitExempt,
  rateLimitErrorResponseBuilder,
  authRateLimitConfig,
} from '../../../config/httpOptimization.js';

test('HTTP Compression & Rate Limiting Configuration Suite', async (t) => {
  await t.test('getCompressionConfig returns valid compression parameters', () => {
    const config = getCompressionConfig();
    assert.ok(typeof config.threshold === 'number');
    assert.ok(Array.isArray(config.encodings));
    assert.ok(config.encodings.includes('br'));
    assert.ok(config.encodings.includes('gzip'));
    assert.ok(config.brotliOptions);
    assert.ok(config.zlibOptions);
  });

  await t.test('isRateLimitExempt correctly identifies health and docs routes', () => {
    assert.equal(isRateLimitExempt('/health'), true);
    assert.equal(isRateLimitExempt('/api/v1/health'), true);
    assert.equal(isRateLimitExempt('/api-docs'), true);
    assert.equal(isRateLimitExempt('/api-docs/static/index.html'), true);

    assert.equal(isRateLimitExempt('/api/v1/articles'), false);
    assert.equal(isRateLimitExempt('/api/v1/auth/login'), false);
    assert.equal(isRateLimitExempt(''), false);
    assert.equal(isRateLimitExempt(null), false);
  });

  await t.test('rateLimitErrorResponseBuilder returns structured 429 payload', () => {
    const payload = rateLimitErrorResponseBuilder({}, { after: '1 minute' });
    assert.equal(payload.statusCode, 429);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(payload.retryAfter, '1 minute');
  });

  await t.test('getRateLimitConfig builds options with allowList and headers', () => {
    const config = getRateLimitConfig({ max: 50 });
    assert.equal(config.max, 50);
    assert.ok(typeof config.allowList === 'function');
    assert.equal(config.allowList({ url: '/health' }), true);
    assert.equal(config.allowList({ url: '/api/v1/projects' }), false);
    assert.ok(config.addHeaders['x-ratelimit-limit']);
  });

  await t.test('authRateLimitConfig provides route-level rate limiting settings', () => {
    assert.ok(authRateLimitConfig.config.rateLimit);
    assert.ok(typeof authRateLimitConfig.config.rateLimit.max === 'number');
    const authError = authRateLimitConfig.config.rateLimit.errorResponseBuilder({}, { after: '30 seconds' });
    assert.equal(authError.statusCode, 429);
    assert.equal(authError.code, 'AUTH_RATE_LIMIT_EXCEEDED');
  });
});

test('HTTP Response Compression Integration Suite', async (t) => {
  const app = Fastify();
  await app.register(compress, getCompressionConfig());

  app.get('/small', async () => ({ hello: 'world' }));
  app.get('/large', async () => ({
    articles: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      title: `Scientific Journal Publication Trend Article ${i + 1}`,
      abstract: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      year: 2026,
    })),
  }));

  await app.ready();

  await t.test('does not compress responses smaller than threshold (1KB)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/small',
      headers: { 'accept-encoding': 'gzip, br' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-encoding'], undefined);
  });

  await t.test('compresses large payloads using Gzip when requested', async () => {
    const uncompressedRes = await app.inject({
      method: 'GET',
      url: '/large',
    });
    const uncompressedSize = uncompressedRes.rawPayload.length;

    const gzipRes = await app.inject({
      method: 'GET',
      url: '/large',
      headers: { 'accept-encoding': 'gzip' },
    });

    assert.equal(gzipRes.statusCode, 200);
    assert.equal(gzipRes.headers['content-encoding'], 'gzip');
    assert.ok(gzipRes.rawPayload.length < uncompressedSize / 3, 'Gzip must reduce size by at least 66%');
  });

  await t.test('compresses large payloads using Brotli when requested', async () => {
    const uncompressedRes = await app.inject({
      method: 'GET',
      url: '/large',
    });
    const uncompressedSize = uncompressedRes.rawPayload.length;

    const brotliRes = await app.inject({
      method: 'GET',
      url: '/large',
      headers: { 'accept-encoding': 'br' },
    });

    assert.equal(brotliRes.statusCode, 200);
    assert.equal(brotliRes.headers['content-encoding'], 'br');
    assert.ok(brotliRes.rawPayload.length < uncompressedSize / 4, 'Brotli must achieve high compression');
  });

  t.after(async () => {
    await app.close();
  });
});

test('API Rate Limiting Integration Suite', async (t) => {
  const app = Fastify();
  await app.register(rateLimit, getRateLimitConfig({ max: 3, timeWindow: '1 minute' }));

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/articles', async () => ({ success: true, data: [] }));
  app.post('/api/v1/auth/login', authRateLimitConfig, async () => ({ success: true, token: 'mock' }));

  await app.ready();

  await t.test('allows requests within rate limit quota and emits rate limit headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/articles' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
  });

  await t.test('blocks requests with 429 when quota is exceeded on standard route', async () => {
    // 1st was used above, consume remaining 2
    await app.inject({ method: 'GET', url: '/api/v1/articles' });
    await app.inject({ method: 'GET', url: '/api/v1/articles' });

    // 4th request must be blocked
    const blockedRes = await app.inject({ method: 'GET', url: '/api/v1/articles' });
    assert.equal(blockedRes.statusCode, 429);
    const body = JSON.parse(blockedRes.body);
    assert.equal(body.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(body.statusCode, 429);
    assert.ok(blockedRes.headers['retry-after']);
  });

  await t.test('exempts /health from rate limiting even after quota is exceeded', async () => {
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthRes.statusCode, 200);
    const body = JSON.parse(healthRes.body);
    assert.equal(body.status, 'ok');
  });

  t.after(async () => {
    await app.close();
  });
});
