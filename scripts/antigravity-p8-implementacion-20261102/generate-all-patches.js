const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { updateDependencies } = require('./apply-dependency-patch');

const pristineDir = path.resolve('output/antigravity-p8-implementacion-20261102/workspace-pristine');
const workDir = path.resolve('output/antigravity-p8-implementacion-20261102/workspace');
const patchesDir = path.resolve('output/antigravity-p8-implementacion-20261102/patches');

fs.mkdirSync(patchesDir, { recursive: true });

function copyFileSafe(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function generateDiff(fileList, patchFileName, sourceDir, pristineRefDir) {
  let combinedDiff = '';
  for (const relPath of fileList) {
    const filePristine = path.join(pristineRefDir, relPath);
    const fileTarget = path.join(sourceDir, relPath);

    if (!fs.existsSync(filePristine) && fs.existsSync(fileTarget)) {
      // New file diff
      const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
      try {
        const out = execSync(`git diff --no-index -- "${devNull}" "${fileTarget}"`, { encoding: 'utf8' });
        combinedDiff += formatDiff(out, relPath, true);
      } catch (e) {
        if (e.stdout) combinedDiff += formatDiff(e.stdout, relPath, true);
      }
    } else if (fs.existsSync(filePristine) && fs.existsSync(fileTarget)) {
      try {
        const out = execSync(`git diff --no-index -- "${filePristine}" "${fileTarget}"`, { encoding: 'utf8' });
        combinedDiff += formatDiff(out, relPath, false);
      } catch (e) {
        if (e.stdout) combinedDiff += formatDiff(e.stdout, relPath, false);
      }
    }
  }

  const outPatch = path.join(patchesDir, patchFileName);
  fs.writeFileSync(outPatch, combinedDiff, 'utf8');
  console.log(`Generated patch: ${patchFileName} (${Buffer.byteLength(combinedDiff, 'utf8')} bytes)`);
}

function formatDiff(rawDiff, relPath, isNew) {
  // Normalize git diff header to standard a/path b/path
  const posixPath = relPath.replace(/\\/g, '/');
  const lines = rawDiff.split(/\r?\n/);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('warning:')) continue;
    if (line.startsWith('diff --git')) {
      result.push(`diff --git a/${posixPath} b/${posixPath}`);
    } else if (line.startsWith('--- ')) {
      result.push(isNew ? `--- /dev/null` : `--- a/${posixPath}`);
    } else if (line.startsWith('+++ ')) {
      result.push(`+++ b/${posixPath}`);
    } else {
      result.push(line);
    }
  }
  return result.join('\n') + '\n';
}

console.log('Generating separate patches...');

// --- Patch 1: Point 103 Rate Limiting and Cache ---
const patch1Files = [
  'src/lib/owner-cache.ts',
  'src/lib/owner-rate-limit.ts',
  'src/app/api/v1/owner/dashboard/route.ts',
  'src/app/api/v1/owner/bootstrap/route.ts',
  'src/app/api/owner/services/route.ts',
  'src/app/api/v1/owner/clients/route.ts',
  'src/app/api/v1/owner/clients/[clientId]/route.ts',
  'src/app/api/business/profile/route.ts',
  'src/tests/antigravity-101-103.test.ts',
  'src/tests/setup.ts',
  'src/tests/server-only.ts',
];
generateDiff(patch1Files, '01-point-103-rate-limit-and-cache.patch', workDir, pristineDir);

// --- Patch 2: Dependencies Security Fix ---
// Prepare temporary folder with pristine + dependency update
const tempDepDir = path.resolve('output/antigravity-p8-implementacion-20261102/temp-dep');
fs.mkdirSync(tempDepDir, { recursive: true });
copyFileSafe(path.join(pristineDir, 'package.json'), path.join(tempDepDir, 'package.json'));
copyFileSafe(path.join(pristineDir, 'package-lock.json'), path.join(tempDepDir, 'package-lock.json'));
updateDependencies(tempDepDir);

const patch2Files = [
  'package.json',
  'package-lock.json',
];
generateDiff(patch2Files, '02-dependencies-security-fix.patch', tempDepDir, pristineDir);
fs.rmSync(tempDepDir, { recursive: true, force: true });

// --- Patch 3: Point 101 Queue & Lease Hardening ---
const patch3Files = [
  'src/lib/android-account-deletion.ts',
];
generateDiff(patch3Files, '03-point-101-queue-lease-hardening.patch', workDir, pristineDir);

// --- Patch 4: Image Confirmation Contract (Inactive Proposal) ---
// Create the proposed contract and proposal file
const proposalDir = path.resolve('output/antigravity-p8-implementacion-20261102/temp-image-proposal');
fs.mkdirSync(path.join(proposalDir, 'src/lib'), { recursive: true });
fs.writeFileSync(
  path.join(proposalDir, 'src/lib/image-confirmation.ts'),
  `/**
 * Inactive Proposal for Two-Phase Image Upload Confirmation
 * Prevents orphan images in Firebase Storage by requiring client confirmation.
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

export type ImageIntent = {
  uid: string;
  category: 'services' | 'avatars' | 'logos';
  expectedFileName: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: 'pending_upload' | 'confirmed' | 'expired';
};

export async function registerImageIntent(db: Firestore, uid: string, category: 'services' | 'avatars' | 'logos', fileName: string) {
  const intentId = \`\${uid}_\${category}_\${Date.now()}\`;
  const ref = db.collection('imageUploadIntents').doc(intentId);
  const now = Date.now();
  await ref.set({
    uid,
    category,
    expectedFileName: fileName,
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60_000), // 24h
    status: 'pending_upload',
  });
  return { intentId };
}
`,
  'utf8'
);
generateDiff(['src/lib/image-confirmation.ts'], '04-image-confirmation-proposal.patch', proposalDir, pristineDir);
fs.rmSync(proposalDir, { recursive: true, force: true });

console.log('All patches generated successfully.');
