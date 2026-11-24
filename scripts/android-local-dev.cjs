// Local full-stack runtime. Start emulators separately with --project demo-pediturno-audit.
// Production provider secrets are removed before Next starts. --compiled uses
// the previously validated local build; all data still targets demo emulators.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env };
const compiled = process.argv.includes('--compiled');
const buildOnly = process.argv.includes('--build');
if (compiled && buildOnly) throw new Error('Choose a build or a server, not both');
for (const key of Object.keys(env)) {
  if (/^(MP_|EMAIL_|GCLOUD_|GOOGLE_PLAY_|GOOGLE_APPLICATION_CREDENTIALS$)/.test(key)) env[key] = '';
}
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && /^(MP_|EMAIL_|GCLOUD_|GOOGLE_PLAY_|GOOGLE_APPLICATION_CREDENTIALS$)/.test(key)) env[key] = '';
  }
}
Object.assign(env, {
  NODE_ENV: compiled || buildOnly ? 'production' : 'development', FIREBASE_PROJECT_ID: 'demo-pediturno-audit', GCLOUD_PROJECT: 'demo-pediturno-audit',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', FIREBASE_STORAGE_BUCKET: 'demo-pediturno-audit.appspot.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-pediturno-audit', NEXT_PUBLIC_FIREBASE_API_KEY: `AIzaSy${'0'.repeat(33)}`,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-pediturno-audit.appspot.com',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdefabcdefabcdef', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  // The compiled candidate serves native API tests only. The web client deliberately
  // rejects emulator mode in production builds; its fake demo config stays inert.
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: compiled || buildOnly ? 'false' : 'true', NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: '127.0.0.1',
  ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS: 'true', MP_PAYMENTS_ENABLED: 'false', MP_MARKETPLACE_ENABLED: 'false',
  BOOKING_CAPABILITY_OUTBOX_KEY: crypto.randomBytes(32).toString('base64'),
  CRON_SECRET: crypto.randomBytes(32).toString('hex'), EMAIL_USER: '', EMAIL_PASS: '',
});
// Next loads .env after process.env; inherited empty values keep secrets disabled.
env.GCLOUD_CLIENT_EMAIL = ''; env.GCLOUD_PRIVATE_KEY_BASE64 = ''; env.GOOGLE_APPLICATION_CREDENTIALS = '';
if (compiled && (!fs.existsSync('.next/BUILD_ID') || !fs.existsSync('.next/standalone/server.js'))) throw new Error('Compile the local standalone web candidate before using --compiled.');
if (compiled) Object.assign(env, { HOSTNAME: '127.0.0.1', PORT: '3000' });
const childArgs = buildOnly ? [require.resolve('next/dist/bin/next'), 'build']
  : compiled ? [path.resolve('.next/standalone/server.js')] : [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000'];
const child = spawn(process.execPath, childArgs, { env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
