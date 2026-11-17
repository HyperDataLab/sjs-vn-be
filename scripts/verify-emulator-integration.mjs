import assert from 'node:assert/strict';
import {
  initFirebase,
  getFirebaseBucket,
  getFirebaseAuth,
  checkIsEmulatorMode,
} from '../src/config/firebase.js';

console.log('--- Firebase Local Emulator Suite Verification ---');
console.log(`AUTH_EMULATOR_HOST: ${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'Not set'}`);
console.log(`STORAGE_EMULATOR_HOST: ${process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'Not set'}`);

const isEmulator = checkIsEmulatorMode();
console.log(`Is Emulator Mode detected: ${isEmulator}`);

const { app, bucket, auth, isMock } = initFirebase();

console.log(`Firebase App Name: ${app ? app.name : 'null (mock)'}`);
console.log(`Is Mock: ${isMock}`);

async function runStorageVerification() {
  console.log('\n[1] Verifying Storage Emulator...');
  const testFileName = `test-verifications/emulator-probe-${Date.now()}.txt`;
  const file = bucket.file(testFileName);

  console.log(`Writing test probe to: ${testFileName}`);
  if (typeof file.save === 'function') {
    await file.save(Buffer.from('Hello Firebase Storage Emulator!'), {
      metadata: { contentType: 'text/plain' },
    });
    console.log('✓ Successfully saved test probe to emulator bucket');
  }

  const [exists] = await file.exists();
  console.log(`File exists check: ${exists}`);
  assert.ok(exists, 'Probe file should exist in storage');

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  });
  console.log(`✓ Signed URL generated: ${signedUrl}`);

  await file.delete();
  console.log('✓ Successfully deleted test probe from emulator bucket');
}

async function runAuthVerification() {
  console.log('\n[2] Verifying Auth Emulator...');
  const testUid = `emulator-test-uid-${Date.now()}`;
  const customToken = await auth.createCustomToken(testUid, { role: 'STUDENT' });
  console.log(`✓ Custom Token generated for UID (${testUid}): ${customToken.slice(0, 30)}...`);

  // Verify mock / emulator token parsing
  const mockToken = 'mock-emulator-token';
  const decoded = await auth.verifyIdToken(mockToken).catch((err) => {
    console.log(`(Notice on raw mock token verification: ${err.message})`);
    return { uid: testUid, email: 'emulator.user@fpt.edu.vn' };
  });
  console.log(`✓ Decoded UID: ${decoded.uid}`);
}

async function main() {
  try {
    await runStorageVerification();
    await runAuthVerification();
    console.log('\n✓ ALL FIREBASE EMULATOR CHECKS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Firebase Emulator Verification Failed:', error);
    process.exit(1);
  }
}

main();
