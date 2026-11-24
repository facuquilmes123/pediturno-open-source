import { describe, expect, it } from 'vitest';
import { safeJsonForScript } from '@/lib/safe-json-script';

describe('JSON-LD HTML serialization', () => {
  it('keeps user-provided closing tags inside JSON data', () => {
    const payload = { name: '</script><script>alert(1)</script>' };
    const serialized = safeJsonForScript(payload);
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});
