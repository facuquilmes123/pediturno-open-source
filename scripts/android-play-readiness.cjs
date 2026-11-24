// Read-only Android Publisher access check. Never creates subscriptions or logs credentials.
// Run explicitly with node --env-file=.env scripts/android-play-readiness.cjs.
const { GoogleAuth } = require('google-auth-library');

async function main() {
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  let credentials;
  if (encoded) credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  else if (process.env.GCLOUD_CLIENT_EMAIL && process.env.GCLOUD_PRIVATE_KEY_BASE64) credentials = {
    client_email: process.env.GCLOUD_CLIENT_EMAIL,
    private_key: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
  };
  if (!credentials) {
    console.log(JSON.stringify({ publisher: 'credentials_missing', packageName: 'com.pediturno.servicios' }));
    return;
  }
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const client = await auth.getClient();
  const packageName = 'com.pediturno.servicios';
  try {
    const { data } = await client.request({
      url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/subscriptions`,
      method: 'GET', timeout: 20_000,
    });
    console.log(JSON.stringify({ publisher: 'readable', packageName, products: (data.subscriptions || []).map(item => ({
      productId: item.productId,
      basePlans: (item.basePlans || []).map(plan => ({ basePlanId: plan.basePlanId, state: plan.state, billingPeriod: plan.autoRenewingBasePlanType?.billingPeriodDuration })),
    })) }));
  } catch (error) {
    const providerError = error.response?.data?.error;
    // ErrorInfo reason codes distinguish disabled APIs from missing grants.
    // Never persist the raw message, request headers, credentials or metadata.
    const reasonCodes = [
      ...(Array.isArray(providerError?.errors) ? providerError.errors.map(item => item?.reason) : []),
      ...(Array.isArray(providerError?.details) ? providerError.details.map(item => item?.reason) : []),
    ].filter(value => typeof value === 'string' && /^[A-Za-z_]{1,80}$/.test(value));
    console.log(JSON.stringify({ publisher: 'unavailable', packageName, operation: 'catalog_subscriptions_list', httpStatus: error.response?.status ?? null, reason: providerError?.status ?? 'request_failed', reasonCodes: [...new Set(reasonCodes)], scope: 'Catalog access only; this does not independently prove purchase verification or acknowledgement permission.' }));
  }
}
main().catch(() => { console.error('Play readiness check failed; no credentials were logged.'); process.exitCode = 1; });
