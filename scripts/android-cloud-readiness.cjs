// Read-only release preflight. No document reads, deployments or credential output.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { GoogleAuth } = require('google-auth-library');
const project = 'pediturno-app';
const normalize = text => String(text).replace(/\r\n/g, '\n').trimEnd();
const hash = text => crypto.createHash('sha256').update(normalize(text)).digest('hex');
const safeError = error => ({ status: 'unavailable', httpStatus: error.response?.status ?? null, reason: error.response?.data?.error?.status ?? 'request_failed',
  // Only public API validation text, never request/config/headers or credentials.
  detail: String(error.response?.data?.error?.message ?? '').replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_.-]+/g, '[redacted]').slice(0, 300) });
function signature(fields) { return JSON.stringify(fields.map(f => ({ fieldPath: f.fieldPath, ...(f.order ? { order: f.order } : {}), ...(f.arrayConfig ? { arrayConfig: f.arrayConfig } : {}) }))); }
async function main() {
  if (process.env.FIREBASE_PROJECT_ID !== project) throw new Error('Unexpected project');
  if (!process.env.GCLOUD_CLIENT_EMAIL || !process.env.GCLOUD_PRIVATE_KEY_BASE64) throw new Error('Server identity unavailable');
  const report = { checkedAt: new Date().toISOString(), project, readOnly: true };
  const client = await new GoogleAuth({ credentials: {
    client_email: process.env.GCLOUD_CLIENT_EMAIL,
    private_key: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
  }, scopes: ['https://www.googleapis.com/auth/firebase.readonly', 'https://www.googleapis.com/auth/datastore'] }).getClient();
  const get = async url => (await client.request({ url, method: 'GET', timeout: 20000, retry: false })).data;
  try {
    const release = await get('https://firebaserules.googleapis.com/v1/projects/' + project + '/releases/cloud.firestore');
    if (!String(release.rulesetName).startsWith('projects/' + project + '/rulesets/')) throw new Error('Unexpected ruleset');
    const ruleset = await get('https://firebaserules.googleapis.com/v1/' + release.rulesetName);
    const files = ruleset.source?.files ?? [];
    const primary = files.find(f => f.name === 'firestore.rules') ?? (files.length === 1 ? files[0] : null);
    const localHash = hash(fs.readFileSync('firestore.rules', 'utf8'));
    report.firestoreRules = { status: 'ok', releaseName: release.name, rulesetName: release.rulesetName,
      localHash, matchesLocalCandidate: !!primary && hash(primary.content) === localHash,
      files: files.map(f => ({ name: f.name, sha256Normalized: hash(f.content) })) };
  } catch (error) { report.firestoreRules = safeError(error); }
  try {
    const required = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8')).indexes ?? [];
    const rows = [];
    for (const group of [...new Set(required.map(index => index.collectionGroup))]) {
      const seen = new Set(); let token = '';
      for (let page = 0; page < 20; page++) {
      const url = new URL('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/collectionGroups/' + encodeURIComponent(group) + '/indexes');
      // This project's Firestore Admin endpoint accepts only the default size.
      if (token) url.searchParams.set('pageToken', token);
      const result = await get(url.toString()); rows.push(...(result.indexes ?? []));
      token = result.nextPageToken ?? ''; if (!token) break;
      if (seen.has(token) || page === 19) throw new Error('Incomplete index pagination'); seen.add(token);
      }
    }
    const checks = required.map(wanted => {
      const includesName = wanted.fields.some(f => f.fieldPath === '__name__');
      const match = rows.find(actual => {
        const parts = String(actual.name).split('/'); const group = parts[parts.indexOf('collectionGroups') + 1];
        const fields = includesName ? actual.fields : actual.fields.filter(f => f.fieldPath !== '__name__');
        return group === wanted.collectionGroup && actual.queryScope === wanted.queryScope && signature(fields) === signature(wanted.fields);
      });
      return { collectionGroup: wanted.collectionGroup, queryScope: wanted.queryScope, fields: wanted.fields, state: match?.state ?? 'NO_EXACT_MATCH' };
    });
    report.indexes = { status: 'ok', activeIndexCount: rows.length, requiredCount: required.length,
      readyCount: checks.filter(c => c.state === 'READY').length, pending: checks.filter(c => c.state !== 'READY'),
      scope: 'Exact candidate index specs; no semantic equivalence inference.' };
  } catch (error) { report.indexes = safeError(error); }
  report.candidateConfigurationReady = report.firestoreRules.matchesLocalCandidate === true && report.indexes.status === 'ok' && report.indexes.pending.length === 0;
  fs.mkdirSync('output/android-implementation-20261026', { recursive: true });
  fs.writeFileSync('output/android-implementation-20261026/firebase-cloud-preflight.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exitCode = report.candidateConfigurationReady ? 0 : 2;
}
const deadline = setTimeout(() => { console.error('Read-only cloud preflight timed out; no credentials were logged.'); process.exit(1); }, 90000);
main().catch(() => { console.error('Read-only cloud preflight failed; no credentials were logged.'); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
