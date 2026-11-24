import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, assertEnvValid } from '../../../config/envValidation.js';

describe('Environment Validation Suite (Fail-Fast Boot Checks)', () => {
  it('passes in test environment with empty env', () => {
    const result = validateEnv({ NODE_ENV: 'test' });
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it('fails in development when database URL is missing', () => {
    const result = validateEnv({ NODE_ENV: 'development' });
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((err) => err.includes('DATABASE_URL')));
  });

  it('passes in development when DATABASE_URL is provided', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
      VN_JWT_SECRET: 'replace-with-a-secret',
    });
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0); // warns about placeholder secret
  });

  it('fails in production if placeholder JWT secret is used', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
      VN_JWT_SECRET: 'replace-with-a-secret',
      VN_JWT_REFRESH_SECRET: 'super-secure-refresh-key-1234567890',
    });
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((err) => err.includes('VN_JWT_SECRET')));
  });

  it('fails in production if placeholder refresh secret is used', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
      VN_JWT_SECRET: 'super-secure-access-key-1234567890',
      VN_JWT_REFRESH_SECRET: 'replace-with-a-secret',
    });
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((err) => err.includes('VN_JWT_REFRESH_SECRET')));
  });

  it('passes in production when all production secrets and DB URLs are properly set', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/db',
      VN_JWT_SECRET: 'super-secure-access-key-1234567890',
      VN_JWT_REFRESH_SECRET: 'super-secure-refresh-key-1234567890',
      CENTRAL_SSO_API_URL: 'https://sso.hyperdatalab.org',
    });
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it('assertEnvValid throws an Error when invalid', () => {
    assert.throws(
      () => assertEnvValid({ NODE_ENV: 'production' }),
      /Environment validation failed/
    );
  });
});
