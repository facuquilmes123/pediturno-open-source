// One Hostinger cron entry drives both authenticated maintenance endpoints.
// Launch with Node 22's --env-file pointing at hbuilds/config/.env; keep this script in config.
import { closeSync, constants as fsConstants, fstatSync, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const origin = 'https://pediturno.com';
const secret = process.env.CRON_SECRET;
const defaultLockPath = '/home/your_hosting_user/domains/pediturno.com/hbuilds/config/.cron-maintenance.lock';
const lockPath = process.env.NODE_ENV === 'test' && process.env.PEDITURNO_CRON_LOCK_PATH
  ? process.env.PEDITURNO_CRON_LOCK_PATH
  : defaultLockPath;

function acquireMaintenanceLock() {
  let fd;
  try {
    fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
    const metadata = fstatSync(fd);
    if (!metadata.isFile()
      || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
      || (metadata.mode & 0o777) !== 0o600) {
      throw new Error('unsafe maintenance lock');
    }
    const flock = spawnSync('/usr/bin/flock', ['-n', '-E', '75', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
    });
    if (flock.error || flock.status === null) throw flock.error || new Error('flock unavailable');
    if (flock.status === 75) {
      closeSync(fd);
      console.log('Pediturno cron: skipped overlap');
      return null;
    }
    if (flock.status !== 0) throw new Error(`flock exited ${flock.status}`);
    return fd;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  }
}

if (!secret || secret.length < 24) {
  console.error('Pediturno cron: missing CRON_SECRET');
  process.exitCode = 1;
} else {
  let lockFd;
  try {
    lockFd = acquireMaintenanceLock();
  } catch {
    console.error('Pediturno cron: maintenance lock unavailable');
    process.exitCode = 1;
  }
  if (lockFd !== undefined && lockFd !== null) {
    try {
      for (const path of ['/api/cron/payments', '/api/cron']) {
        try {
          const response = await fetch(`${origin}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secret}` },
            redirect: 'error',
            signal: AbortSignal.timeout(90_000),
          });
          console.log(`Pediturno cron: ${path} HTTP ${response.status}`);
          if (!response.ok) process.exitCode = 1;
        } catch {
          console.error(`Pediturno cron: ${path} unavailable`);
          process.exitCode = 1;
        }
      }
    } finally {
      closeSync(lockFd);
    }
  }
}
