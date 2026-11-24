import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Enterprise = {
  ready(callback: () => void): void;
};

type RecaptchaWindow = Window & {
  grecaptcha?: { enterprise?: Enterprise };
};

const scriptSelector = 'script[data-pediturno-recaptcha-enterprise="true"]';

function setEnterprise(ready: Enterprise["ready"]): void {
  (window as RecaptchaWindow).grecaptcha = { enterprise: { ready } };
}

async function loadSubject() {
  return import("@/lib/recaptcha-enterprise-loader");
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  delete (window as RecaptchaWindow).grecaptcha;
  document.querySelectorAll(scriptSelector).forEach((script) => script.remove());
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as RecaptchaWindow).grecaptcha;
  document.querySelectorAll(scriptSelector).forEach((script) => script.remove());
});

describe("ensureRecaptchaEnterpriseLoaded", () => {
  it("waits for an already loaded Enterprise API to become ready", async () => {
    let readyCallback: (() => void) | undefined;
    const ready = vi.fn((callback: () => void) => {
      readyCallback = callback;
    });
    setEnterprise(ready);
    const { ensureRecaptchaEnterpriseLoaded } = await loadSubject();

    let resolved = false;
    const pending = ensureRecaptchaEnterpriseLoaded().then(() => {
      resolved = true;
    });

    expect(ready).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    expect(document.querySelector(scriptSelector)).toBeNull();

    readyCallback?.();
    await pending;
    expect(resolved).toBe(true);
  });

  it("uses one fallback script load for concurrent callers", async () => {
    const { ensureRecaptchaEnterpriseLoaded } = await loadSubject();

    const first = ensureRecaptchaEnterpriseLoaded();
    const second = ensureRecaptchaEnterpriseLoaded();
    expect(first).toBe(second);

    const script = document.querySelector<HTMLScriptElement>(scriptSelector);
    expect(script).not.toBeNull();
    expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
    expect(script?.src).toBe("https://www.recaptcha.net/recaptcha/enterprise.js?render=explicit");

    setEnterprise((callback) => callback());
    script?.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBeUndefined();
  });

  it("allows a retry after the fallback script fails", async () => {
    const { ensureRecaptchaEnterpriseLoaded } = await loadSubject();

    const failed = ensureRecaptchaEnterpriseLoaded();
    document.querySelector<HTMLScriptElement>(scriptSelector)?.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow("Unable to load reCAPTCHA Enterprise");

    const retry = ensureRecaptchaEnterpriseLoaded();
    const script = document.querySelector<HTMLScriptElement>(scriptSelector);
    expect(script).not.toBeNull();
    setEnterprise((callback) => callback());
    script?.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeUndefined();
  });

  it("times out and releases the single-flight lock for a later retry", async () => {
    vi.useFakeTimers();
    const { ensureRecaptchaEnterpriseLoaded } = await loadSubject();

    const timedOut = ensureRecaptchaEnterpriseLoaded();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(timedOut).rejects.toThrow("Timed out loading reCAPTCHA Enterprise");

    const retry = ensureRecaptchaEnterpriseLoaded();
    expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
    setEnterprise((callback) => callback());
    document.querySelector<HTMLScriptElement>(scriptSelector)?.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeUndefined();
  });
});
