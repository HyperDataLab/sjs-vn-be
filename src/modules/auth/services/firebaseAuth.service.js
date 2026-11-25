import crypto from 'crypto';
import prisma from '../../../config/prisma.js';
import logger from '../../../utils/logger.js';
import { getFirebaseAuth, isAuthMock, isEmulatorMode } from '../../../config/firebase.js';
import { signChildAccessToken } from '../config/authTokens.js';
import { signRefreshToken } from './login.service.js';
import { findUsersByNormalizedEmail, normalizeEmail } from '../repositories/sso.repository.js';

const authError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

/**
 * Verify Firebase ID Token via Firebase Admin or Emulator/Mock
 * @param {string} idToken
 * @returns {Promise<Object>} Decoded Firebase token payload
 */
export const verifyFirebaseToken = async (idToken) => {
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    throw authError(401, 'FIREBASE_TOKEN_MISSING', 'Firebase ID token is missing or invalid');
  }

  const auth = getFirebaseAuth();

  try {
    const decodedToken = await auth.verifyIdToken(idToken.trim());
    return decodedToken;
  } catch (error) {
    logger.warn(`Firebase token verification failed: ${error.message} (code: ${error.code})`);
    if (error.code === 'auth/id-token-expired') {
      throw authError(401, 'FIREBASE_TOKEN_EXPIRED', 'Firebase ID token has expired');
    }
    if (error.code === 'auth/id-token-revoked') {
      throw authError(401, 'FIREBASE_TOKEN_REVOKED', 'Firebase ID token has been revoked');
    }
    throw authError(401, 'FIREBASE_TOKEN_INVALID', error.message || 'Firebase ID token is invalid');
  }
};

/**
 * Resolve local user from Firebase decoded token
 * @param {string} idToken
 * @param {Object} options
 * @returns {Promise<Object>} Local user record
 */
export const resolveFirebaseUser = async (idToken, { autoCreate = true } = {}) => {
  const decoded = await verifyFirebaseToken(idToken);

  if (!decoded?.email) {
    throw authError(400, 'FIREBASE_EMAIL_MISSING', 'Firebase account has no associated email address');
  }

  // Security guard: require verified email to prevent account takeover via unverified email signups
  if (decoded.email_verified === false) {
    throw authError(403, 'EMAIL_NOT_VERIFIED', 'Email Firebase chưa được xác thực');
  }

  const normalized = normalizeEmail(decoded.email);
  const existingUsers = await findUsersByNormalizedEmail(normalized);

  if (existingUsers.length > 1) {
    throw authError(409, 'EMAIL_IDENTITY_AMBIGUOUS', 'Multiple local accounts match this Firebase email');
  }

  let user = existingUsers[0] || null;

  if (user) {
    if (user.status === 'BANNED') {
      throw authError(403, 'ACCOUNT_BANNED', 'Tài khoản của bạn đã bị khóa');
    }
    if (user.status === 'INACTIVE') {
      throw authError(403, 'ACCOUNT_INACTIVE', 'Tài khoản của bạn chưa được kích hoạt');
    }
    return user;
  }

  if (!autoCreate) {
    throw authError(404, 'USER_NOT_FOUND', 'Người dùng chưa được đăng ký trong hệ thống');
  }

  // JIT provision user for Firebase Google / Email sign-in
  const newUserId = crypto.randomUUID();
  const displayName = decoded.name || decoded.displayName || 'Firebase User';
  const nameParts = displayName.trim().split(/\s+/);
  const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0] || 'User';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  user = await prisma.user.create({
    data: {
      user_id: newUserId,
      email: normalized,
      password: null,
      type: 'GOOGLE',
      status: 'ACTIVE',
      role: 'STUDENT',
      first_name: firstName,
      last_name: lastName,
      url_image: decoded.picture || null,
    },
  });

  logger.info(`JIT created new local user for Firebase Auth: ${normalized} (id: ${newUserId})`);
  return user;
};

/**
 * Handle Firebase Login workflow: verifies token, maps user, issues child session tokens
 * @param {Object} params
 * @param {string} params.idToken
 * @param {boolean} [params.remember=false]
 * @returns {Promise<Object>}
 */
export const loginWithFirebase = async ({ idToken, remember = false }) => {
  const user = await resolveFirebaseUser(idToken, { autoCreate: true });

  const childToken = signChildAccessToken({
    user_id: user.user_id,
    role: user.role,
    email: user.email,
  });

  const refreshToken = remember ? signRefreshToken(user) : null;

  return {
    user,
    token: childToken,
    refreshToken,
    isEmulator: isEmulatorMode(),
    isMock: isAuthMock(),
  };
};

/**
 * Create a Firebase custom token (supported in emulator or with service account)
 * @param {string} uid
 * @param {Object} [developerClaims={}]
 * @returns {Promise<string>}
 */
export const createFirebaseCustomToken = async (uid, developerClaims = {}) => {
  const auth = getFirebaseAuth();
  return auth.createCustomToken(uid, developerClaims);
};
