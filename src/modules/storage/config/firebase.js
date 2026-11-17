import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';
import logger from '../../../utils/logger.js';

dotenv.config();

let firebaseApp = null;
let storageBucket = null;
let isMockStorage = false;

const initFirebase = () => {
  if (firebaseApp && storageBucket) {
    return { app: firebaseApp, bucket: storageBucket, isMock: isMockStorage };
  }

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'scientificjournalsystem.appspot.com';
  const serviceAccountKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      firebaseApp = existingApps[0];
      storageBucket = getStorage(firebaseApp).bucket(bucketName);
      return { app: firebaseApp, bucket: storageBucket, isMock: false };
    }

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
        storageBucket: bucketName,
      });
      storageBucket = getStorage(firebaseApp).bucket(bucketName);
      logger.info(`Firebase Admin initialized successfully with bucket: ${bucketName}`);
      return { app: firebaseApp, bucket: storageBucket, isMock: false };
    }

    // Nếu không có credentials và đang trong môi trường dev/test
    if (process.env.NODE_ENV !== 'production' || process.env.MOCK_STORAGE === 'true') {
      logger.warn('Firebase credentials not found. Initializing storage in dev/mock fallback mode.');
      isMockStorage = true;
      storageBucket = {
        name: bucketName,
        file: (name) => ({
          name,
          getSignedUrl: async (options) => {
            const exp = typeof options.expires === 'number' ? options.expires : Date.now() + 15 * 60 * 1000;
            return [`https://storage.googleapis.com/${bucketName}/${name}?mock_signed=true&expires=${exp}`];
          },
          delete: async () => [{ status: 204 }],
          exists: async () => [true],
        }),
      };
      return { app: null, bucket: storageBucket, isMock: true };
    }

    // Production without credentials: try default application credentials
    firebaseApp = initializeApp({
      credential: applicationDefault(),
      storageBucket: bucketName,
    });
    storageBucket = getStorage(firebaseApp).bucket(bucketName);
    return { app: firebaseApp, bucket: storageBucket, isMock: false };
  } catch (error) {
    logger.warn(`Firebase initialization notice: ${error.message}. Using fallback storage.`);
    isMockStorage = true;
    storageBucket = {
      name: bucketName,
      file: (name) => ({
        name,
        getSignedUrl: async () => [`https://storage.googleapis.com/${bucketName}/${name}?fallback=true`],
        delete: async () => [{ status: 204 }],
        exists: async () => [false],
      }),
    };
    return { app: null, bucket: storageBucket, isMock: true };
  }
};

export const getFirebaseBucket = () => {
  if (!storageBucket) {
    initFirebase();
  }
  return storageBucket;
};

export const isStorageMock = () => isMockStorage;

export const getStorageBucketName = () => {
  return process.env.FIREBASE_STORAGE_BUCKET || 'scientificjournalsystem.appspot.com';
};

export const getCloudflareWorkerUrl = () => {
  const url = process.env.CLOUDFLARE_WORKER_URL || process.env.CDN_BASE_URL || 'http://localhost:8787';
  return url.replace(/\/+$/, '');
};
