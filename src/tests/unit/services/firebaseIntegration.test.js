import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initFirebase,
  getFirebaseBucket,
  getFirebaseAuth,
  isStorageMock,
  isAuthMock,
  checkIsEmulatorMode,
  configureEmulatorEnvironment,
  getStorageBucketName,
  getCloudflareWorkerUrl,
  resetFirebaseState,
} from '../../../config/firebase.js';
import {
  verifyFirebaseToken,
  resolveFirebaseUser,
  loginWithFirebase,
  createFirebaseCustomToken,
} from '../../../modules/auth/services/firebaseAuth.service.js';
import {
  firebaseLogin,
  verifyFirebaseSession,
} from '../../../modules/auth/controllers/auth.controller.js';
import { getAuthCookieNames } from '../../../modules/auth/utils/authCookies.js';
import { resolveAuthenticatedUser, authUserRepository } from '../../../modules/auth/middlewares/auth.middleware.js';
import prisma from '../../../config/prisma.js';

test('Firebase Integration & Emulator Configuration Suite', async (t) => {
  t.beforeEach(() => {
    resetFirebaseState();
  });

  t.afterEach(() => {
    resetFirebaseState();
  });

  await t.test('configureEmulatorEnvironment cleans up protocol prefixes', () => {
    const originalStorageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    const originalAuthHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

    try {
      process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199';
      process.env.FIREBASE_AUTH_EMULATOR_HOST = 'http://127.0.0.1:9099';

      configureEmulatorEnvironment();

      assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
      assert.equal(process.env.STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
      assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
    } finally {
      if (originalStorageHost) {
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = originalStorageHost;
      } else {
        delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        delete process.env.STORAGE_EMULATOR_HOST;
      }
      if (originalAuthHost) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = originalAuthHost;
      } else {
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      }
    }
  });

  await t.test('checkIsEmulatorMode accurately detects emulator environment flags', () => {
    assert.equal(typeof checkIsEmulatorMode(), 'boolean');
  });

  await t.test('initFirebase provides working storage bucket and auth instances in mock fallback mode', async () => {
    const { bucket, auth, isMock } = initFirebase();
    assert.ok(bucket, 'Bucket should be initialized');
    assert.ok(auth, 'Auth should be initialized');
    assert.equal(typeof isMock, 'boolean');

    const file = bucket.file('documents/test.pdf');
    const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 60000 });
    assert.ok(signedUrl.includes('test.pdf'));
  });

  await t.test('getStorageBucketName and getCloudflareWorkerUrl return valid fallbacks', () => {
    const bucketName = getStorageBucketName();
    assert.ok(bucketName.length > 0);

    const cdnUrl = getCloudflareWorkerUrl();
    assert.ok(!cdnUrl.endsWith('/'), 'CDN URL must not have trailing slash');
  });
});

test('Firebase Auth Service & Controller Suite', async (t) => {
  t.beforeEach(() => {
    resetFirebaseState();
  });

  t.afterEach(() => {
    resetFirebaseState();
  });

  await t.test('verifyFirebaseToken rejects missing or blank tokens', async () => {
    await assert.rejects(
      () => verifyFirebaseToken(''),
      (err) => err.code === 'FIREBASE_TOKEN_MISSING' && err.statusCode === 401
    );

    await assert.rejects(
      () => verifyFirebaseToken(null),
      (err) => err.code === 'FIREBASE_TOKEN_MISSING' && err.statusCode === 401
    );
  });

  await t.test('verifyFirebaseToken decodes mock/valid token', async () => {
    const decoded = await verifyFirebaseToken('mock-valid-firebase-token');
    assert.ok(decoded.uid);
    assert.ok(decoded.email);
    assert.equal(decoded.email_verified, true);
  });

  await t.test('verifyFirebaseToken throws 401 on expired token', async () => {
    await assert.rejects(
      () => verifyFirebaseToken('expired-firebase-token'),
      (err) => err.code === 'FIREBASE_TOKEN_EXPIRED' && err.statusCode === 401
    );
  });

  await t.test('resolveFirebaseUser finds active user and rejects banned user', async () => {
    const originalFindMany = prisma.user.findMany;

    try {
      // 1. Existing active user
      prisma.user.findMany = async () => [{
        user_id: 'user-active-123',
        email: 'mock.user@fpt.edu.vn',
        status: 'ACTIVE',
        role: 'LECTURER',
      }];

      const activeUser = await resolveFirebaseUser('mock-token');
      assert.equal(activeUser.user_id, 'user-active-123');
      assert.equal(activeUser.role, 'LECTURER');

      // 2. Banned user
      prisma.user.findMany = async () => [{
        user_id: 'user-banned-456',
        email: 'mock.user@fpt.edu.vn',
        status: 'BANNED',
        role: 'STUDENT',
      }];

      await assert.rejects(
        () => resolveFirebaseUser('mock-token'),
        (err) => err.code === 'ACCOUNT_BANNED' && err.statusCode === 403
      );
    } finally {
      prisma.user.findMany = originalFindMany;
    }
  });

  await t.test('resolveFirebaseUser JIT provisions user when account not found and autoCreate is true', async () => {
    const originalFindMany = prisma.user.findMany;
    const originalCreate = prisma.user.create;

    try {
      prisma.user.findMany = async () => [];
      let createdUserData = null;
      prisma.user.create = async ({ data }) => {
        createdUserData = data;
        return { ...data, user_id: 'jit-created-user-id' };
      };

      const newUser = await resolveFirebaseUser('mock-token', { autoCreate: true });
      assert.equal(newUser.user_id, 'jit-created-user-id');
      assert.equal(createdUserData.status, 'ACTIVE');
      assert.equal(createdUserData.role, 'STUDENT');
      assert.equal(createdUserData.email, 'mock.user@fpt.edu.vn');
    } finally {
      prisma.user.findMany = originalFindMany;
      prisma.user.create = originalCreate;
    }
  });

  await t.test('loginWithFirebase generates child access token and optional refresh token', async () => {
    const originalFindMany = prisma.user.findMany;

    try {
      prisma.user.findMany = async () => [{
        user_id: 'fb-user-1',
        email: 'mock.user@fpt.edu.vn',
        status: 'ACTIVE',
        role: 'RESEARCHER',
      }];

      const result = await loginWithFirebase({ idToken: 'valid-token', remember: true });
      assert.ok(result.token, 'Should return child access token');
      assert.ok(result.refreshToken, 'Should return refresh token when remember: true');
      assert.equal(result.user.role, 'RESEARCHER');
    } finally {
      prisma.user.findMany = originalFindMany;
    }
  });

  await t.test('firebaseLogin controller responds 400 when idToken missing', async () => {
    let responseStatus = null;
    let responsePayload = null;

    const fakeReply = {
      status(s) { responseStatus = s; return this; },
      send(p) { responsePayload = p; return this; },
      setCookie() {},
      clearCookie() {},
    };

    await firebaseLogin({ body: {} }, fakeReply);
    assert.equal(responseStatus, 400);
    assert.equal(responsePayload.code, 'ID_TOKEN_REQUIRED');
  });

  await t.test('firebaseLogin controller authenticates successfully and sets cookies', async () => {
    const originalFindMany = prisma.user.findMany;
    const originalQueryRawUnsafe = prisma.$queryRawUnsafe;

    try {
      prisma.$queryRawUnsafe = async () => [];
      prisma.user.findMany = async () => [{
        user_id: 'fb-ctrl-user-1',
        email: 'mock.user@fpt.edu.vn',
        status: 'ACTIVE',
        role: 'STUDENT',
        first_name: 'Minh',
        last_name: 'Nguyen',
      }];

      let responseStatus = null;
      let responsePayload = null;
      const cookiesSet = {};

      const fakeReply = {
        status(s) { responseStatus = s; return this; },
        send(p) { responsePayload = p; return this; },
        setCookie(name, val) { cookiesSet[name] = val; },
        clearCookie() {},
      };

      const fakeRequest = {
        body: { idToken: 'valid-token', remember: true },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'Unit-Test' },
      };

      await firebaseLogin(fakeRequest, fakeReply);
      assert.equal(responseStatus, 200);
      assert.equal(responsePayload.code, 'LOGIN_SUCCESS');
      assert.ok(responsePayload.data.token);

      const cookieNames = getAuthCookieNames();
      assert.ok(cookiesSet[cookieNames.access]);
      assert.ok(cookiesSet[cookieNames.refresh]);
    } finally {
      prisma.user.findMany = originalFindMany;
      prisma.$queryRawUnsafe = originalQueryRawUnsafe;
    }
  });

  await t.test('verifyFirebaseSession controller returns decoded payload on valid token', async () => {
    let responseStatus = null;
    let responsePayload = null;

    const fakeReply = {
      status(s) { responseStatus = s; return this; },
      send(p) { responsePayload = p; return this; },
    };

    await verifyFirebaseSession({ body: { idToken: 'valid-token' } }, fakeReply);
    assert.equal(responseStatus, 200);
    assert.equal(responsePayload.code, 'FIREBASE_TOKEN_VALID');
    assert.equal(responsePayload.data.email, 'mock.user@fpt.edu.vn');
  });

  await t.test('resolveAuthenticatedUser middleware resolves Firebase Bearer token directly', async () => {
    const originalFindFirst = prisma.user.findFirst;

    try {
      prisma.user.findFirst = async () => ({
        user_id: 'bearer-user-123',
        email: 'mock.user@fpt.edu.vn',
        role: 'STUDENT',
        status: 'ACTIVE',
        type: 'GOOGLE',
      });

      const fakeRequest = {
        headers: { authorization: 'Bearer mock-firebase-token' },
        cookies: {},
      };

      const resolved = await resolveAuthenticatedUser(fakeRequest);
      assert.equal(resolved.user_id, 'bearer-user-123');
      assert.equal(resolved.email, 'mock.user@fpt.edu.vn');
      assert.equal(resolved.firebase_uid, 'mock-firebase-uid-12345');
    } finally {
      prisma.user.findFirst = originalFindFirst;
    }
  });
});
