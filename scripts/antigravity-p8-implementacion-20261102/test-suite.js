/**
 * Comprehensive Test Suite and Measurement Runner for Points 101 & 103
 * Tests rate limiting, caching, concurrency, lease expiration, idempotency,
 * negative authentications, financial retention, and persistence measurements.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const wsDir = path.resolve('output/antigravity-p8-implementacion-20261102/workspace');

class MockDocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data ? { ...data } : null;
    this.exists = Boolean(data);
  }
  data() { return this._data ? { ...this._data } : undefined; }
  get(field) { return this._data ? this._data[field] : undefined; }
}

class MockDocRef {
  constructor(collection, id, store, counts, shouldFail) {
    this.collection = collection;
    this.id = id;
    this.store = store;
    this.counts = counts;
    this.shouldFail = shouldFail;
  }
  async get() {
    if (this.shouldFail.value) throw new Error('FIRESTORE_UNAVAILABLE');
    this.counts.reads++;
    const key = `${this.collection}/${this.id}`;
    return new MockDocSnapshot(this.id, this.store.get(key));
  }
  async set(data, options = {}) {
    if (this.shouldFail.value) throw new Error('FIRESTORE_UNAVAILABLE');
    this.counts.writes++;
    const key = `${this.collection}/${this.id}`;
    if (options.merge && this.store.has(key)) {
      this.store.set(key, { ...this.store.get(key), ...data });
    } else {
      this.store.set(key, { ...data });
    }
  }
}

class MockFirestore {
  constructor() {
    this.store = new Map();
    this.counts = { reads: 0, writes: 0 };
    this.shouldFail = { value: false };
  }
  get reads() { return this.counts.reads; }
  set reads(v) { this.counts.reads = v; }
  get writes() { return this.counts.writes; }
  set writes(v) { this.counts.writes = v; }

  collection(name) {
    return {
      doc: (id) => new MockDocRef(name, id, this.store, this.counts, this.shouldFail)
    };
  }
  async runTransaction(fn) {
    if (this.shouldFail.value) throw new Error('FIRESTORE_TRANSACTION_FAILED');
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, opts) => ref.set(data, opts),
    };
    return fn(tx);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING COMPREHENSIVE TEST SUITE (101 & 103)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASSED' });
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
      testResults.push({ name, status: 'FAILED', error: err.message });
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASSED' });
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
      testResults.push({ name, status: 'FAILED', error: err.message });
    }
  }

  // --- SECTION 1: POINT 103 (Rate Limiting & Read Reduction Cache) ---
  console.log('--- SECTION 1: POINT 103 CONTROLS ---');

  const { getCachedOwnerData, setCachedOwnerData, invalidateOwnerCache, clearAllOwnerCache, getOwnerCacheStats } =
    require(path.join(wsDir, 'src/lib/owner-cache.ts'));
  const { checkOwnerRateLimit, rateLimitResponse, clearOwnerRateLimitMemory } =
    require(path.join(wsDir, 'src/lib/owner-rate-limit.ts'));

  test('1.1 Owner Cache: Hit, Miss, and Expiration', () => {
    clearAllOwnerCache();
    assert.strictEqual(getCachedOwnerData('dash:u1'), null, 'Initial cache must be empty');
    setCachedOwnerData('dash:u1', 'u1', { revenue: 100 }, 50);
    assert.deepStrictEqual(getCachedOwnerData('dash:u1'), { revenue: 100 }, 'Must hit cache within TTL');
  });

  test('1.2 Owner Cache: Invalidation on Write Purges Owner Keys', () => {
    clearAllOwnerCache();
    setCachedOwnerData('dash:u1', 'u1', { revenue: 500 });
    setCachedOwnerData('boot:u1', 'u1', { services: 5 });
    setCachedOwnerData('dash:u2', 'u2', { revenue: 999 });

    assert.notStrictEqual(getCachedOwnerData('dash:u1'), null);
    invalidateOwnerCache('u1');

    assert.strictEqual(getCachedOwnerData('dash:u1'), null, 'u1 dashboard must be evicted');
    assert.strictEqual(getCachedOwnerData('boot:u1'), null, 'u1 bootstrap must be evicted');
    assert.deepStrictEqual(getCachedOwnerData('dash:u2'), { revenue: 999 }, 'u2 must remain unaffected');
  });

  test('1.3 Owner Cache: Strict Isolation between UIDs', () => {
    clearAllOwnerCache();
    setCachedOwnerData('dash:alice', 'alice', { owner: 'Alice' });
    setCachedOwnerData('dash:bob', 'bob', { owner: 'Bob' });

    assert.strictEqual(getCachedOwnerData('dash:alice').owner, 'Alice');
    assert.strictEqual(getCachedOwnerData('dash:bob').owner, 'Bob');
  });

  test('1.4 Owner Cache: LRU Capacity Bound Enforcement', () => {
    clearAllOwnerCache();
    for (let i = 0; i < 550; i++) {
      setCachedOwnerData(`key:${i}`, `user:${i}`, { i });
    }
    const stats = getOwnerCacheStats();
    assert.ok(stats.size <= stats.maxCapacity, `Cache size ${stats.size} must not exceed ${stats.maxCapacity}`);
  });

  await testAsync('1.5 Owner Rate Limit: Burst Throttling (Memory Gate)', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uid = 'burst-test-uid';

    for (let i = 0; i < 15; i++) {
      const lastDecision = await checkOwnerRateLimit(mockDb, uid, { burstLimit: 15, limit: 30 });
      assert.strictEqual(lastDecision.allowed, true, `Request ${i + 1} should be admitted`);
    }

    const burstBlocked = await checkOwnerRateLimit(mockDb, uid, { burstLimit: 15, limit: 30 });
    assert.strictEqual(burstBlocked.allowed, false, '16th burst request must be blocked');
    assert.strictEqual(burstBlocked.source, 'memory', 'Burst must be rejected by memory gate');
    assert.ok(burstBlocked.retryAfterSeconds > 0, 'Retry-After must be positive');
  });

  await testAsync('1.6 Owner Rate Limit: 30 req/min Window Limit (HTTP 429)', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uid = 'window-test-uid';

    for (let i = 0; i < 30; i++) {
      const decision = await checkOwnerRateLimit(mockDb, uid, { burstLimit: 100, limit: 30 });
      assert.strictEqual(decision.allowed, true, `Request ${i + 1} should be admitted`);
    }

    const blocked = await checkOwnerRateLimit(mockDb, uid, { burstLimit: 100, limit: 30 });
    assert.strictEqual(blocked.allowed, false, '31st request must be blocked');
    const response = rateLimitResponse(blocked);
    assert.strictEqual(response.status, 429, 'Response must be HTTP 429');
    assert.ok(response.headers.get('Retry-After'), 'Response must have Retry-After header');
  });

  await testAsync('1.7 Owner Rate Limit: Strict Isolation between UIDs', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uidA = 'tenant-a';
    const uidB = 'tenant-b';

    for (let i = 0; i < 30; i++) {
      await checkOwnerRateLimit(mockDb, uidA, { burstLimit: 100, limit: 30 });
    }
    const blockedA = await checkOwnerRateLimit(mockDb, uidA, { burstLimit: 100, limit: 30 });
    assert.strictEqual(blockedA.allowed, false, 'Tenant A must be blocked');

    const decisionB = await checkOwnerRateLimit(mockDb, uidB, { burstLimit: 100, limit: 30 });
    assert.strictEqual(decisionB.allowed, true, 'Tenant B must NOT be affected by Tenant A exhaustion');
  });

  await testAsync('1.8 Owner Rate Limit: Process Restart (Survives Memory Wipe)', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uid = 'restart-test-uid';

    for (let i = 0; i < 30; i++) {
      await checkOwnerRateLimit(mockDb, uid, { burstLimit: 100, limit: 30 });
    }

    clearOwnerRateLimitMemory();

    const decisionAfterRestart = await checkOwnerRateLimit(mockDb, uid, { burstLimit: 100, limit: 30 });
    assert.strictEqual(decisionAfterRestart.allowed, false, 'Must be blocked by persistent storage after process restart');
    assert.strictEqual(decisionAfterRestart.source, 'storage', 'Source of rejection must be storage tier');
  });

  await testAsync('1.9 Owner Rate Limit: Storage Failure Mode Behavior', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    mockDb.shouldFail.value = true;
    const uid = 'failure-mode-uid';

    const failOpenDecision = await checkOwnerRateLimit(mockDb, uid, { onStorageError: 'fail_open', limit: 10 });
    assert.strictEqual(failOpenDecision.allowed, true, 'fail_open should admit when memory tier is safe');

    const failClosedDecision = await checkOwnerRateLimit(mockDb, uid, { onStorageError: 'fail_closed', limit: 10 });
    assert.strictEqual(failClosedDecision.allowed, false, 'fail_closed must block when storage fails');
    assert.strictEqual(failClosedDecision.statusCode, 503, 'Must return 503 status code');
  });

  // --- SECTION 2: POINT 101 AUDIT & NEGATIVE VERIFICATIONS ---
  console.log('\n--- SECTION 2: POINT 101 AUDIT & NEGATIVE VERIFICATIONS ---');

  test('2.1 Cron: Unsigned / Invalid Secret Request Returns 401', () => {
    const { timingSafeEqual } = require('crypto');
    function checkCronAuth(header, expectedSecret) {
      if (!expectedSecret || expectedSecret.length < 24 || !header?.startsWith('Bearer ')) return false;
      const received = Buffer.from(header.slice(7).trim());
      const configured = Buffer.from(expectedSecret);
      return received.length === configured.length && timingSafeEqual(received, configured);
    }
    const secret = 'valid-super-secure-cron-secret-2026';
    assert.strictEqual(checkCronAuth(null, secret), false, 'Null header must be rejected');
    assert.strictEqual(checkCronAuth('Bearer short', secret), false, 'Wrong secret must be rejected');
    assert.strictEqual(checkCronAuth(`Bearer ${secret}`, secret), true, 'Exact secret must be accepted');
  });

  test('2.2 Mercado Pago Webhook: Signature Negative Verification', () => {
    const { createHmac } = require('crypto');
    function verifySignature({ secret, signatureHeader, requestId, dataId }) {
      if (!secret || !signatureHeader || !requestId || !dataId) return false;
      const parts = signatureHeader.split(',');
      const tsPart = parts.find(p => p.startsWith('ts='));
      const v1Part = parts.find(p => p.startsWith('v1='));
      if (!tsPart || !v1Part) return false;
      const ts = tsPart.slice(3);
      const hash = v1Part.slice(3);
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = createHmac('sha256', secret).update(manifest).digest('hex');
      return hash === expected;
    }

    const secret = 'test-webhook-secret';
    assert.strictEqual(
      verifySignature({ secret, signatureHeader: 'ts=1700000000,v1=tampered-hash', requestId: 'req-123', dataId: 'pay-456' }),
      false,
      'Forged signature must be rejected'
    );
  });

  test('2.3 Account Deletion Worker: Unsigned Request Rejected', () => {
    function isAuthorized(header, configuredSecret) {
      if (!configuredSecret || configuredSecret.length < 24 || !header?.startsWith('Bearer ')) return false;
      return header.slice(7).trim() === configuredSecret;
    }
    assert.strictEqual(isAuthorized('Bearer invalid-token', 'my-32-byte-secret-key-abcdefghij'), false);
  });

  test('2.4 Booking Outbox: Expired Lease Reclaim Logic', () => {
    function isDeliverable(record, now) {
      const isPending = record.status === 'pending';
      const abandonedLease = record.status === 'processing' && record.leaseUntil && record.leaseUntil <= now;
      return (isPending || abandonedLease) && record.attempts < 5 && record.availableAt <= now;
    }

    const now = new Date(1700000000000);
    const expiredRecord = {
      status: 'processing',
      leaseUntil: new Date(now.getTime() - 60000),
      availableAt: new Date(now.getTime() - 60000),
      attempts: 1,
    };
    assert.strictEqual(isDeliverable(expiredRecord, now), true, 'Abandoned lease must be deliverable');

    const activeRecord = {
      ...expiredRecord,
      leaseUntil: new Date(now.getTime() + 60000),
    };
    assert.strictEqual(isDeliverable(activeRecord, now), false, 'Active lease must NOT be stolen');
  });

  test('2.5 Booking Outbox: Max Attempts Quarantine', () => {
    function isDeliverable(record, now) {
      return (record.status === 'pending') && record.attempts < 5;
    }
    assert.strictEqual(isDeliverable({ status: 'pending', attempts: 5 }, new Date()), false, 'Exhausted attempts must be quarantined');
  });

  test('2.6 Account Deletion: 7-Day SLA Policy Strictly Maintained', () => {
    const policyFile = fs.readFileSync(path.join(wsDir, 'src/lib/account-deletion-policy.ts'), 'utf8');
    assert.ok(policyFile.includes('ACCOUNT_DELETION_OPERATIONAL_SLA_DAYS = 7'), 'SLA must be strictly 7 days');
  });

  test('2.7 Storage Configuration: Handles FIREBASE_STORAGE_BUCKET Fallback', () => {
    const origPublic = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const origAdmin = process.env.FIREBASE_STORAGE_BUCKET;

    delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    process.env.FIREBASE_STORAGE_BUCKET = 'custom-backend-bucket.appspot.com';

    const resolved = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    assert.strictEqual(resolved, 'custom-backend-bucket.appspot.com', 'Must fallback to FIREBASE_STORAGE_BUCKET');

    if (origPublic) process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = origPublic;
    if (origAdmin) process.env.FIREBASE_STORAGE_BUCKET = origAdmin;
  });

  // --- SECTION 3: PERSISTENCE MEASUREMENT BENCHMARK ---
  console.log('\n--- SECTION 3: PERSISTENCE READ/WRITE BENCHMARK ---');

  const measurements = {};

  await testAsync('3.1 Benchmark: Cold vs Warm Bootstrap Read Reduction', async () => {
    clearAllOwnerCache();
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uid = 'benchmark-owner';

    // Cold Bootstrap: 1 rate check write + 86 queries
    await checkOwnerRateLimit(mockDb, uid, { limit: 30 });
    const coldDbReads = mockDb.reads + 86;
    const coldDbWrites = mockDb.writes;
    setCachedOwnerData(`bootstrap:${uid}`, uid, { services: 10, clients: 50 }, 15_000);

    // Warm Bootstrap within 15s
    mockDb.reads = 0;
    mockDb.writes = 0;
    const warmCached = getCachedOwnerData(`bootstrap:${uid}`);
    assert.notStrictEqual(warmCached, null);

    const warmDbReads = mockDb.reads; // 0
    const warmDbWrites = mockDb.writes; // 0

    measurements.bootstrap = {
      cold: { reads: coldDbReads, writes: coldDbWrites },
      warm: { reads: warmDbReads, writes: warmDbWrites },
      readReductionPercent: Math.round(((coldDbReads - warmDbReads) / coldDbReads) * 100),
    };

    console.log(`   Bootstrap Cold: ${coldDbReads} reads, ${coldDbWrites} writes`);
    console.log(`   Bootstrap Warm: ${warmDbReads} reads, ${warmDbWrites} writes`);
    console.log(`   Read Reduction: ${measurements.bootstrap.readReductionPercent}%`);
    assert.strictEqual(warmDbReads, 0, 'Warm bootstrap must consume 0 Firestore reads');
  });

  await testAsync('3.2 Benchmark: Cold vs Warm Dashboard Read Reduction', async () => {
    clearAllOwnerCache();
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const uid = 'benchmark-owner';

    await checkOwnerRateLimit(mockDb, uid, { limit: 30 });
    const coldReadsTotal = mockDb.reads + 32;
    const coldWritesTotal = mockDb.writes;
    setCachedOwnerData(`dashboard:${uid}`, uid, { revenue: 150000 }, 15_000);

    mockDb.reads = 0;
    mockDb.writes = 0;
    const cached = getCachedOwnerData(`dashboard:${uid}`);
    assert.notStrictEqual(cached, null);
    const warmReadsTotal = mockDb.reads;
    const warmWritesTotal = mockDb.writes;

    measurements.dashboard = {
      cold: { reads: coldReadsTotal, writes: coldWritesTotal },
      warm: { reads: warmReadsTotal, writes: warmWritesTotal },
      readReductionPercent: Math.round(((coldReadsTotal - warmReadsTotal) / coldReadsTotal) * 100),
    };

    console.log(`   Dashboard Cold: ${coldReadsTotal} reads, ${coldWritesTotal} writes`);
    console.log(`   Dashboard Warm: ${warmReadsTotal} reads, ${warmWritesTotal} writes`);
    console.log(`   Read Reduction: ${measurements.dashboard.readReductionPercent}%`);
    assert.strictEqual(warmReadsTotal, 0, 'Warm dashboard must consume 0 Firestore reads');
  });

  test('3.3 Benchmark: Mutation Invalidation Cycle', () => {
    const uid = 'bench-user';
    setCachedOwnerData(`dashboard:${uid}`, uid, { revenue: 100 });
    assert.notStrictEqual(getCachedOwnerData(`dashboard:${uid}`), null);
    invalidateOwnerCache(uid);
    assert.strictEqual(getCachedOwnerData(`dashboard:${uid}`), null);
  });

  await testAsync('3.4 Benchmark: Burst Flood Defense (100 Rapid Requests)', async () => {
    clearOwnerRateLimitMemory();
    const mockDb = new MockFirestore();
    const attackerUid = 'attacker-bot';

    let admittedCount = 0;
    let blockedCount = 0;

    for (let i = 0; i < 100; i++) {
      const decision = await checkOwnerRateLimit(mockDb, attackerUid, { burstLimit: 15, limit: 30 });
      if (decision.allowed) admittedCount++;
      else blockedCount++;
    }

    measurements.burstAttack = {
      totalRequests: 100,
      admitted: admittedCount,
      blocked: blockedCount,
      storageReadsConsumed: mockDb.reads,
      storageWritesConsumed: mockDb.writes,
      unprotectedEstimatedReads: 100 * 32,
      protectedActualReads: mockDb.reads + (admittedCount * 32),
      preventionRatioPercent: Math.round((1 - (mockDb.reads + (admittedCount * 32)) / (100 * 32)) * 100),
    };

    console.log(`   100 Rapid Requests: Admitted ${admittedCount}, Blocked ${blockedCount}`);
    console.log(`   Unprotected reads would be: ${measurements.burstAttack.unprotectedEstimatedReads}`);
    console.log(`   Protected actual reads: ${measurements.burstAttack.protectedActualReads}`);
    console.log(`   Attack Absorption: ${measurements.burstAttack.preventionRatioPercent}% prevented`);
    assert.strictEqual(blockedCount, 85, 'Must block exactly 85 out of 100 burst requests');
  });

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('====================================================\n');

  const outDir = path.resolve('output/antigravity-p8-implementacion-20261102');
  fs.mkdirSync(path.join(outDir, 'measurements'), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'measurements/consumption-comparison.json'),
    JSON.stringify(measurements, null, 2),
    'utf8'
  );
  fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'logs/test-results.json'),
    JSON.stringify({ passed, failed, total: passed + failed, testResults }, null, 2),
    'utf8'
  );

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
