import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

let firebaseApp = null;
let storageBucket = null;
let firebaseAuth = null;
let isMockStorage = false;
let isMockAuth = false;
let isEmulator = false;

/**
 * Configure environment variables for Firebase emulators if present
 */
export const configureEmulatorEnvironment = () => {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, '');
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = host;
    process.env.STORAGE_EMULATOR_HOST = host;
  } else if (process.env.STORAGE_EMULATOR_HOST) {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, '');
  }

  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST.replace(/^https?:\/\//, '');
  }
};

/**
 * Check if running against Firebase Emulators
 */
export const checkIsEmulatorMode = () => {
  return Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.STORAGE_EMULATOR_HOST
  );
};

/**
 * Create a mock Firebase Storage Bucket for dev/test when credentials & emulator are absent
 */
const createMockStorageBucket = (bucketName) => ({
  name: bucketName,
  file: (name) => ({
    name,
    getSignedUrl: async (options = {}) => {
      const exp = typeof options.expires === 'number' ? options.expires : Date.now() + 15 * 60 * 1000;
      return [`https://storage.googleapis.com/${bucketName}/${name}?mock_signed=true&expires=${exp}`];
    },
    delete: async () => [{ status: 204 }],
    exists: async () => [true],
    save: async () => [{ status: 200 }],
  }),
});

/**
 * Create a mock Firebase Auth instance for dev/test when credentials & emulator are absent
 */
const createMockFirebaseAuth = () => ({
  verifyIdToken: async (idToken) => {
    if (!idToken || typeof idToken !== 'string') {
      const err = new Error('Decoding Firebase ID token failed. Token is missing or invalid.');
      err.code = 'auth/argument-error';
      throw err;
    }

    if (idToken === 'invalid-token' || idToken.includes('expired')) {
      const err = new Error('Firebase ID token has expired or is invalid.');
      err.code = 'auth/id-token-expired';
      throw err;
    }

    // Default mock verified token
    return {
      uid: 'mock-firebase-uid-12345',
      email: 'mock.user@fpt.edu.vn',
      email_verified: true,
      name: 'Mock Firebase User',
      picture: 'https://example.com/avatar.png',
      auth_time: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/scientificjournalsystem-dev',
      aud: 'scientificjournalsystem-dev',
      sub: 'mock-firebase-uid-12345',
    };
  },
  createCustomToken: async (uid, developerClaims = {}) => {
    return `mock-custom-token-${uid}-${Date.now()}`;
  },
  getUserByEmail: async (email) => ({
    uid: `mock-uid-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
    email,
    displayName: 'Mock User',
    emailVerified: true,
  }),
});

/**
 * Initialize Firebase Admin SDK (Supports Cloud Credentials, Emulators, and Fallback Mock)
 */
export const initFirebase = () => {
  if (firebaseApp && storageBucket && firebaseAuth) {
    return {
      app: firebaseApp,
      bucket: storageBucket,
      auth: firebaseAuth,
      isMock: isMockStorage,
      isEmulator,
    };
  }

  configureEmulatorEnvironment();

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'scientificjournalsystem.appspot.com';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'scientificjournalsystem-dev';
  const serviceAccountKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      firebaseApp = existingApps[0];
      storageBucket = getStorage(firebaseApp).bucket(bucketName);
      firebaseAuth = getAuth(firebaseApp);
      isEmulator = checkIsEmulatorMode();
      isMockStorage = false;
      isMockAuth = false;
      return {
        app: firebaseApp,
        bucket: storageBucket,
        auth: firebaseAuth,
        isMock: false,
        isEmulator,
      };
    }

    // 1. Emulator Mode Detection
    if (checkIsEmulatorMode()) {
      isEmulator = true;
      isMockStorage = false;
      isMockAuth = false;
      firebaseApp = initializeApp({
        projectId,
        storageBucket: bucketName,
      });
      storageBucket = getStorage(firebaseApp).bucket(bucketName);
      firebaseAuth = getAuth(firebaseApp);
      logger.info(
        `Firebase Admin initialized in EMULATOR mode (Auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'disabled'}, Storage: ${process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'disabled'})`
      );
      return {
        app: firebaseApp,
        bucket: storageBucket,
        auth: firebaseAuth,
        isMock: false,
        isEmulator: true,
      };
    }

    // 2. Production / Cloud Credentials
    let credential = null;
    if (serviceAccountKeyJson) {
      try {
        const parsed = JSON.parse(serviceAccountKeyJson);
        credential = cert(parsed);
      } catch (err) {
        logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON, falling back.');
      }
    }

    if (!credential && projectId && clientEmail && privateKey) {
      credential = cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      });
    }

    if (credential) {
      firebaseApp = initializeApp({
        credential,
        projectId,
        storageBucket: bucketName,
      });
      storageBucket = getStorage(firebaseApp).bucket(bucketName);
      firebaseAuth = getAuth(firebaseApp);
      isEmulator = false;
      isMockStorage = false;
      isMockAuth = false;
      logger.info(`Firebase Admin initialized successfully with bucket: ${bucketName}`);
      return {
        app: firebaseApp,
        bucket: storageBucket,
        auth: firebaseAuth,
        isMock: false,
        isEmulator: false,
      };
    }

    // 3. Dev / Test Mock Fallback Mode
    if (process.env.NODE_ENV !== 'production' || process.env.MOCK_STORAGE === 'true' || process.env.MOCK_AUTH === 'true') {
      logger.warn('Firebase credentials not found and emulators inactive. Initializing storage & auth in dev/mock fallback mode.');
      isMockStorage = true;
      isMockAuth = true;
      isEmulator = false;
      storageBucket = createMockStorageBucket(bucketName);
      firebaseAuth = createMockFirebaseAuth();
      return {
        app: null,
        bucket: storageBucket,
        auth: firebaseAuth,
        isMock: true,
        isEmulator: false,
      };
    }

    // 4. Default Application Credentials for production on GCP
    firebaseApp = initializeApp({
      credential: applicationDefault(),
      projectId,
      storageBucket: bucketName,
    });
    storageBucket = getStorage(firebaseApp).bucket(bucketName);
    firebaseAuth = getAuth(firebaseApp);
    isEmulator = false;
    isMockStorage = false;
    isMockAuth = false;
    return {
      app: firebaseApp,
      bucket: storageBucket,
      auth: firebaseAuth,
      isMock: false,
      isEmulator: false,
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      logger.error(`Critical Firebase initialization failure in production: ${error.message}`);
      throw error;
    }
    logger.warn(`Firebase initialization notice: ${error.message}. Using fallback mock.`);
    isMockStorage = true;
    isMockAuth = true;
    isEmulator = false;
    storageBucket = createMockStorageBucket(bucketName);
    firebaseAuth = createMockFirebaseAuth();
    return {
      app: null,
      bucket: storageBucket,
      auth: firebaseAuth,
      isMock: true,
      isEmulator: false,
    };
  }
};

export const getFirebaseApp = () => {
  if (!firebaseApp && !isMockStorage) {
    initFirebase();
  }
  return firebaseApp;
};

export const getFirebaseBucket = () => {
  if (!storageBucket) {
    initFirebase();
  }
  return storageBucket;
};

export const getFirebaseAuth = () => {
  if (!firebaseAuth) {
    initFirebase();
  }
  return firebaseAuth;
};

export const isStorageMock = () => isMockStorage;
export const isAuthMock = () => isMockAuth;
export const isEmulatorMode = () => isEmulator;

export const getStorageBucketName = () => {
  return process.env.FIREBASE_STORAGE_BUCKET || 'scientificjournalsystem.appspot.com';
};

export const getCloudflareWorkerUrl = () => {
  const url = process.env.CLOUDFLARE_WORKER_URL || process.env.CDN_BASE_URL || 'http://localhost:8787';
  return url.replace(/\/+$/, '');
};

/**
 * Reset Firebase state (useful for test isolation)
 */
export const resetFirebaseState = () => {
  firebaseApp = null;
  storageBucket = null;
  firebaseAuth = null;
  isMockStorage = false;
  isMockAuth = false;
  isEmulator = false;
};
