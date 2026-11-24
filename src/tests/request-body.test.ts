import { describe, expect, it } from 'vitest';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
describe('bounded JSON reader', () => {
 it('rejects oversized undeclared bodies instead of trusting Content-Length', async () => {
  const request = new Request('https://pediturno.test', { method: 'POST', body: JSON.stringify({ value: 'a'.repeat(1000) }) });
  await expect(readLimitedJson(request, 64)).rejects.toBeInstanceOf(RequestBodyTooLarge);
 });
 it('parses small bodies and rejects malformed JSON', async () => {
  await expect(readLimitedJson(new Request('https://pediturno.test', { method: 'POST', body: '{"ok":true}' }), 64)).resolves.toEqual({ ok: true });
  await expect(readLimitedJson(new Request('https://pediturno.test', { method: 'POST', body: '{' }), 64)).rejects.toBeInstanceOf(SyntaxError);
 });
});
