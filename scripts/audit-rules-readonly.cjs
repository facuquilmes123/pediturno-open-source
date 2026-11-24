const fs = require('node:fs');
const crypto = require('node:crypto');
const { cert } = require('firebase-admin/app');
(async () => {
  const project = process.env.FIREBASE_PROJECT_ID;
  if (project !== 'pediturno-app') throw Error('Unexpected project');
  const credential = cert({ projectId: project, clientEmail: process.env.GCLOUD_CLIENT_EMAIL, privateKey: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64 || '', 'base64').toString('utf8') });
  const { access_token } = await credential.getAccessToken();
  const read = async path => {
    const res = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Error(`Rules API HTTP ${res.status}`);
    return res.json();
  };
  const { releases = [] } = await read(`projects/${project}/releases`);
  const sha = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
  const evidence = [];
  for (const release of releases) {
    const file = release.name.includes('cloud.firestore') ? 'firestore.rules' : release.name.includes('firebase.storage') ? 'storage.rules' : null;
    if (!file) continue;
    const ruleset = await read(release.rulesetName);
    const files = ruleset.source?.files || [];
    evidence.push({ release: release.name, updatedAt: release.updateTime, matchesLocal: files.some(remote => sha(remote.content) === sha(fs.readFileSync(file, 'utf8'))), file });
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), evidence }));
})().catch(error => { console.error(/Rules API HTTP/.test(error.message) ? error.message : 'Rules verification unavailable; no credentials logged.'); process.exitCode = 1; });
