import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Hostinger injects dashboard variables into the main virtual host only.
// All three portals use the same protected configuration and standalone release.
export function loadHostingerEnvironment(cwd = process.cwd()): boolean {
  if (!/^\/home\/[^/]+\/domains\/pediturno\.com\/hbuilds\/(?:versions\/[^/]+|current)\/nodejs$/.test(cwd)) return false;
  const config = resolve(cwd, cwd.includes('/versions/') ? '../../../config/.env' : '../../config/.env');
  if (!existsSync(config)) return false;
  const file = statSync(config);
  if (!file.isFile() || (file.mode & 0o077) !== 0 || typeof process.getuid === 'function' && file.uid !== process.getuid()) {
    throw new Error('Shared runtime configuration must be private to the application user');
  }
  // Native parsing preserves existing managed variables and never exposes values.
  process.loadEnvFile(config);
  return true;
}
