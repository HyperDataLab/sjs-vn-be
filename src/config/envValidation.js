import logger from '../utils/logger.js';

/**
 * Validate required environment variables at server boot (Fail-Fast pattern).
 * Prevents latent runtime failures and cryptic crashes in production.
 *
 * @param {object} [env=process.env]
 * @returns {{ isValid: boolean, errors: string[], warnings: string[] }}
 */
export const validateEnv = (env = process.env) => {
  const errors = [];
  const warnings = [];

  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test' || Boolean(env.NODE_TEST_CONTEXT);

  // 1. Database Connection String
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL;
  if (!dbUrl && !isTest) {
    errors.push('DATABASE_URL hoặc POSTGRES_URL là bắt buộc nhưng chưa được cấu hình.');
  }

  // 2. JWT Signing Secrets
  const jwtSecret = env.VN_JWT_SECRET;
  const jwtRefreshSecret = env.VN_JWT_REFRESH_SECRET;

  if (isProduction) {
    if (!jwtSecret || jwtSecret === 'replace-with-a-secret') {
      errors.push('VN_JWT_SECRET phải được thiết lập giá trị bảo mật an toàn trên Production.');
    }
    if (!jwtRefreshSecret || jwtRefreshSecret === 'replace-with-a-secret') {
      errors.push('VN_JWT_REFRESH_SECRET phải được thiết lập giá trị bảo mật an toàn trên Production.');
    }
  } else if (!isTest) {
    if (!jwtSecret || jwtSecret === 'replace-with-a-secret') {
      warnings.push('VN_JWT_SECRET đang dùng giá trị mặc định/placeholder. Cần thay thế trước khi lên Production.');
    }
  }

  // 3. Central SSO URL
  if (isProduction && !env.CENTRAL_SSO_API_URL) {
    warnings.push('CENTRAL_SSO_API_URL chưa được cấu hình rõ ràng, mặc định sẽ trỏ về http://localhost:3001.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * Assert environment validity at startup. If invalid, log descriptive errors and terminate process.
 * @param {object} [env=process.env]
 */
export const assertEnvValid = (env = process.env) => {
  const { isValid, errors, warnings } = validateEnv(env);

  warnings.forEach((warn) => {
    logger.warn(`[EnvValidation WARNING]: ${warn}`);
  });

  if (!isValid) {
    errors.forEach((err) => {
      logger.error(`[EnvValidation FATAL]: ${err}`);
    });
    throw new Error(`Environment validation failed with ${errors.length} error(s):\n - ${errors.join('\n - ')}`);
  }
};
