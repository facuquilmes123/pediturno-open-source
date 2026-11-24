const RECAPTCHA_ENTERPRISE_URL = "https://www.recaptcha.net/recaptcha/enterprise.js?render=explicit";
const RECAPTCHA_LOAD_TIMEOUT_MS = 15_000;
const SCRIPT_ATTRIBUTE = "data-pediturno-recaptcha-enterprise";

type EnterpriseApi = { ready(callback: () => void): void };
type RecaptchaGlobal = typeof globalThis & { grecaptcha?: { enterprise?: EnterpriseApi } };

let loading: Promise<void> | null = null;

function enterpriseApi(): EnterpriseApi | undefined {
  return (globalThis as RecaptchaGlobal).grecaptcha?.enterprise;
}

/** Preloads Google's official Enterprise alternate host before App Check starts. */
function loadEnterpriseApi(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("reCAPTCHA Enterprise requires a browser"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    let createdScript = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      if (script) { script.onload = null; script.onerror = null; }
      if (error) {
        if (createdScript) script?.remove();
        reject(error);
      } else resolve();
    };
    const waitUntilReady = () => {
      const enterprise = enterpriseApi();
      if (!enterprise) return finish(new Error("reCAPTCHA Enterprise API was unavailable after loading"));
      try { enterprise.ready(() => finish()); }
      catch { finish(new Error("reCAPTCHA Enterprise failed to initialize")); }
    };
    const timeout = globalThis.setTimeout(
      () => finish(new Error("Timed out loading reCAPTCHA Enterprise")),
      RECAPTCHA_LOAD_TIMEOUT_MS,
    );

    if (enterpriseApi()) return waitUntilReady();
    script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTRIBUTE}="true"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = RECAPTCHA_ENTERPRISE_URL;
      script.async = true;
      script.defer = true;
      script.setAttribute(SCRIPT_ATTRIBUTE, "true");
      createdScript = true;
    }
    script.onload = waitUntilReady;
    script.onerror = () => finish(new Error("Unable to load reCAPTCHA Enterprise"));
    if (createdScript) document.head.appendChild(script);
  });
}

export function ensureRecaptchaEnterpriseLoaded(): Promise<void> {
  if (loading) return loading;
  const attempt = loadEnterpriseApi();
  loading = attempt;
  void attempt.then(undefined, () => {
    if (loading === attempt) loading = null;
  });
  return attempt;
}
