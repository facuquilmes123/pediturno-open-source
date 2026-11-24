'use client';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let pendingPrompt: InstallPromptEvent | null = null;
export const INSTALL_STATE_EVENT = 'pediturno-install-state';
export function isIosDevice(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function getInstallPrompt(): InstallPromptEvent | null { return pendingPrompt; }
// Capture early without showing an install promotion on the public landing.
export function listenForInstallPrompt(): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    pendingPrompt = event as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
  };
  const onInstalled = () => {
    pendingPrompt = null;
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = pendingPrompt;
  if (!event) return 'unavailable';
  pendingPrompt = null;
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } finally { window.dispatchEvent(new Event(INSTALL_STATE_EVENT)); }
}
