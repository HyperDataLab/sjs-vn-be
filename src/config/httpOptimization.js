import zlib from 'node:zlib';

/**
 * Configure HTTP response compression options for Fastify (Brotli, Gzip, Deflate)
 * @returns {object} @fastify/compress configuration object
 */
export const getCompressionConfig = () => {
  const threshold = Number(process.env.COMPRESSION_THRESHOLD || 1024);

  return {
    threshold,
    encodings: ['br', 'gzip', 'deflate'],
    brotliOptions: {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      },
    },
    zlibOptions: {
      level: 6,
    },
  };
};

/**
 * List of URL path prefixes exempt from rate limiting
 */
const EXEMPT_PREFIXES = [
  '/health',
  '/api/v1/health',
  '/api-docs',
];

/**
 * Check if a request URL is exempt from rate limiting
 * @param {string} url
 * @returns {boolean}
 */
export const isRateLimitExempt = (url = '') => {
  if (!url || typeof url !== 'string') return false;
  return EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix));
};

/**
 * Standardized error response builder for 429 Too Many Requests
 * @param {object} request
 * @param {object} context
 * @returns {object}
 */
export const rateLimitErrorResponseBuilder = (_request, context) => ({
  statusCode: 429,
  error: 'Too Many Requests',
  success: false,
  code: 'RATE_LIMIT_EXCEEDED',
  message: 'Hệ thống đã nhận quá nhiều yêu cầu từ bạn. Vui lòng thử lại sau giây lát.',
  retryAfter: context.after,
});

/**
 * Configure global rate limit options for Fastify
 * @param {object} [customOptions]
 * @returns {object} @fastify/rate-limit configuration object
 */
export const getRateLimitConfig = (customOptions = {}) => {
  const isTest = process.env.NODE_ENV === 'test';
  const defaultMax = isTest ? 2000 : 200;
  const max = Number(process.env.RATE_LIMIT_MAX || defaultMax);
  const timeWindow = process.env.RATE_LIMIT_TIME_WINDOW || '1 minute';

  return {
    max,
    timeWindow,
    allowList: (req) => isRateLimitExempt(req.url),
    errorResponseBuilder: rateLimitErrorResponseBuilder,
    skipOnError: true,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    ...customOptions,
  };
};

/**
 * Strict rate limiting configuration preset for sensitive authentication endpoints
 */
export const authRateLimitConfig = {
  config: {
    rateLimit: {
      max: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
      timeWindow: process.env.AUTH_RATE_LIMIT_WINDOW || '1 minute',
      errorResponseBuilder: (_request, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        success: false,
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Bạn đã gửi yêu cầu xác thực quá nhiều lần. Vui lòng đợi và thử lại sau.',
        retryAfter: context.after,
      }),
    },
  },
};
