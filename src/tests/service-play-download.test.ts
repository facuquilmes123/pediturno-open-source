import { describe, expect, it } from 'vitest';
import { isPublicServicePlayListing } from '@/lib/service-play-download';
import { SERVICE_PLAY_URL } from '@/lib/config';

const listing = '<meta property="og:title" content="Pediturno: Agenda y turnos - Apps en Google Play"><button><span>Instalar</span></button>';
describe('public Android download admission', () => {
  it('offers the store CTA only for the correct public installable listing', () => {
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL, listing)).toBe(true);
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL, listing.replace('Instalar', 'Install'))).toBe(true);
  });
  it.each([404, 403, 429, 500])('keeps the web option when Google responds %s', status => {
    expect(isPublicServicePlayListing(status, SERVICE_PLAY_URL, listing)).toBe(false);
  });
  it('does not mistake a pre-registration or unavailable page for a download', () => {
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL, listing.replace('Instalar', 'Registro previo'))).toBe(false);
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL, '<title>No se ha encontrado.</title>')).toBe(false);
  });
  it('rejects a login/interstitial or another app even with a successful HTTP status', () => {
    expect(isPublicServicePlayListing(200, 'https://consent.google.com/', listing)).toBe(false);
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL.replace('com.pediturno.servicios', 'com.example.other'), listing)).toBe(false);
    expect(isPublicServicePlayListing(200, SERVICE_PLAY_URL, listing.replace('Pediturno: Agenda y turnos', 'Another app'))).toBe(false);
  });
});
