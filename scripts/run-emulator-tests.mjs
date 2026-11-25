import { spawn } from 'child_process';
import http from 'http';

const checkPort = (port) => new Promise((resolve) => {
  const req = http.get(`http://127.0.0.1:${port}`, () => resolve(true));
  req.on('error', () => resolve(false));
  req.setTimeout(800, () => {
    req.destroy();
    resolve(false);
  });
});

async function main() {
  console.log('--- Running Tests in Firebase Emulator Mode ---');

  const authRunning = await checkPort(9099);
  const storageRunning = await checkPort(9199);

  const env = { ...process.env };

  if (authRunning) {
    console.log('✓ Detected active Firebase Auth Emulator on port 9099');
    env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  } else {
    console.log('ℹ Firebase Auth Emulator not detected on port 9099 (using mock fallback)');
  }

  if (storageRunning) {
    console.log('✓ Detected active Firebase Storage Emulator on port 9199');
    env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    env.STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  } else {
    console.log('ℹ Firebase Storage Emulator not detected on port 9199 (using mock fallback)');
  }

  if (!env.FIREBASE_PROJECT_ID) {
    env.FIREBASE_PROJECT_ID = 'scientificjournalsystem-dev';
  }

  console.log('\nExecuting test suite...\n');

  const testProcess = spawn(
    'node',
    ['--test', '--experimental-test-module-mocks', 'src/tests/unit/**/*.test.js'],
    {
      stdio: 'inherit',
      env,
      shell: true,
    }
  );

  testProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
