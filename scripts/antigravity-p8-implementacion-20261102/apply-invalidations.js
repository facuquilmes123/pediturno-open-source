const fs = require('fs');
const path = require('path');

const wsDir = path.resolve('output/antigravity-p8-implementacion-20261102/workspace');

// 1. services/route.ts
{
  const filePath = path.join(wsDir, 'src/app/api/owner/services/route.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('invalidateOwnerCache')) {
    content = "import { invalidateOwnerCache } from '@/lib/owner-cache';\n" + content;
    // in POST
    content = content.replace(
      "return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });",
      "invalidateOwnerCache(uid);\n    return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });"
    );
    // in PATCH
    content = content.replace(
      "await runOwnedImageCleanup(db, uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });",
      "await runOwnedImageCleanup(db, uid);\n    invalidateOwnerCache(uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });"
    );
    // in DELETE
    content = content.replace(
      "await runOwnedImageCleanup(db, uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });",
      "await runOwnedImageCleanup(db, uid);\n    invalidateOwnerCache(uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });"
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated src/app/api/owner/services/route.ts');
  }
}

// 2. clients/route.ts
{
  const filePath = path.join(wsDir, 'src/app/api/v1/owner/clients/route.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('invalidateOwnerCache')) {
    content = "import { invalidateOwnerCache } from '@/lib/owner-cache';\n" + content;
    content = content.replace(
      "return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });",
      "invalidateOwnerCache(owner.uid);\n    return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });"
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated src/app/api/v1/owner/clients/route.ts');
  }
}

// 3. clients/[clientId]/route.ts
{
  const filePath = path.join(wsDir, 'src/app/api/v1/owner/clients/[clientId]/route.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('invalidateOwnerCache')) {
    content = "import { invalidateOwnerCache } from '@/lib/owner-cache';\n" + content;
    // in PATCH
    content = content.replace(
      "await runOwnedImageCleanup(owner.db, owner.uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });",
      "await runOwnedImageCleanup(owner.db, owner.uid);\n    invalidateOwnerCache(owner.uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });"
    );
    // in DELETE
    content = content.replace(
      "await runOwnedImageCleanup(owner.db, owner.uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });",
      "await runOwnedImageCleanup(owner.db, owner.uid);\n    invalidateOwnerCache(owner.uid);\n    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });"
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated src/app/api/v1/owner/clients/[clientId]/route.ts');
  }
}

// 4. business/profile/route.ts
{
  const filePath = path.join(wsDir, 'src/app/api/business/profile/route.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('invalidateOwnerCache')) {
    content = "import { invalidateOwnerCache } from '@/lib/owner-cache';\n" + content;
    content = content.replace(
      "return NextResponse.json({ ok: true, created, welcome: welcomeName });",
      "invalidateOwnerCache(uid);\n      return NextResponse.json({ ok: true, created, welcome: welcomeName });"
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated src/app/api/business/profile/route.ts');
  }
}

// 5. android-account-deletion.ts (storage bucket fix)
{
  const filePath = path.join(wsDir, 'src/lib/android-account-deletion.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  const target = "  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;";
  const replacement = "  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : undefined);";
  if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated src/lib/android-account-deletion.ts bucket fallback');
  }
}

console.log('All invalidations and fixes applied successfully.');
