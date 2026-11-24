// Read-only check of the release client's Play Integrity configuration.
const fs = require('node:fs');
const { GoogleAuth } = require('google-auth-library');

async function main() {
  if (process.env.FIREBASE_PROJECT_ID !== 'pediturno-app') throw new Error('Unexpected project');
  const sdk = JSON.parse(fs.readFileSync('android/pediturno-servicios/app/google-services.json', 'utf8').replace(/^\uFEFF/, ''));
  const app = sdk.client.find(item => item.client_info?.android_client_info?.package_name === 'com.pediturno.servicios');
  if (!app) throw new Error('Release SDK client is absent');
  const name = `projects/${sdk.project_info.project_number}/apps/${app.client_info.mobilesdk_app_id}/playIntegrityConfig`;
  const client = await new GoogleAuth({ credentials: {
    client_email: process.env.GCLOUD_CLIENT_EMAIL,
    private_key: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64 || '', 'base64').toString('utf8'),
  }, scopes: ['https://www.googleapis.com/auth/firebase'] }).getClient();
  try {
    const { data } = await client.request({ url: `https://firebaseappcheck.googleapis.com/v1/${name}`, method: 'GET', timeout: 20_000 });
    console.log(JSON.stringify({ appCheck: 'configured', packageName: 'com.pediturno.servicios', tokenTtl: data.tokenTtl || 'default', allowUnrecognizedVersion: data.appIntegrity?.allowUnrecognizedVersion === true, requireLicensed: data.accountDetails?.requireLicensed === true }));
  } catch (error) {
    console.log(JSON.stringify({ appCheck: 'unavailable', packageName: 'com.pediturno.servicios', httpStatus: error.response?.status ?? null, reason: error.response?.data?.error?.status ?? 'request_failed' }));
  }
}
main().catch(() => { console.error('App Check readiness failed; no credentials were logged.'); process.exitCode = 1; });
