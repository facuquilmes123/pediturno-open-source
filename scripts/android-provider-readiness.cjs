// Read-only provider checks. Run with node --env-file=.env; never log credentials.
const { GoogleAuth } = require('google-auth-library');
async function main() {
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!project || !process.env.GCLOUD_CLIENT_EMAIL || !process.env.GCLOUD_PRIVATE_KEY_BASE64) {
    console.log(JSON.stringify({ firebase: 'missing_server_credentials' })); return;
  }
  const auth = new GoogleAuth({ credentials: {
    client_email: process.env.GCLOUD_CLIENT_EMAIL,
    private_key: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
  }, scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'] });
  const client = await auth.getClient();
  const resources = [
    ['androidApps', `https://firebase.googleapis.com/v1beta1/projects/${project}/androidApps`],
    ['webApps', `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`],
    ['authProviders', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs`],
  ];
  for (const [kind, url] of resources) {
    try {
      const { data } = await client.request({ url, method: 'GET' });
      const apps = data.apps || data.defaultSupportedIdpConfigs || [];
      console.log(JSON.stringify({ kind, status: 'readable', items: apps.map(app => ({
        name: app.name, packageName: app.packageName, displayName: app.displayName,
        enabled: app.enabled, state: app.state,
      })) }));
    } catch (error) {
      console.log(JSON.stringify({ kind, status: error.response?.status || 'unavailable',
        reason: error.response?.data?.error?.status || 'request_failed' }));
    }
  }
}
main().catch(() => { console.error('Provider readiness failed; credentials were not logged.'); process.exitCode = 1; });
