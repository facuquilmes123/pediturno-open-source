import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
const io = vi.hoisted(() => ({ exists: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs', () => ({ default: { existsSync: io.exists, statSync: io.stat }, existsSync: io.exists, statSync: io.stat }));
import { loadHostingerEnvironment } from '@/lib/hostinger-runtime';
const cwd = '/home/your_hosting_user/domains/pediturno.com/hbuilds/versions/release/nodejs';
afterEach(() => vi.restoreAllMocks());
describe('shared portal runtime configuration', () => {
  it('does not load configuration outside the deployed Pediturno runtime', () => {
    expect(loadHostingerEnvironment('/home/user/domains/other.com/hbuilds/current/nodejs')).toBe(false);
    expect(loadHostingerEnvironment('C:/project')).toBe(false);
  });
  it('loads the shared protected file for a versioned release', () => {
    io.exists.mockReturnValue(true);
    io.stat.mockReturnValue({ isFile: () => true, mode: 0o100600, uid: process.getuid?.() });
    const load = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
    expect(loadHostingerEnvironment(cwd)).toBe(true);
    expect(load).toHaveBeenCalledWith(resolve(cwd, '../../../config/.env'));
  });
  it('rejects a configuration readable by another user', () => {
    io.exists.mockReturnValue(true);
    io.stat.mockReturnValue({ isFile: () => true, mode: 0o100644, uid: process.getuid?.() });
    expect(() => loadHostingerEnvironment(cwd)).toThrow('private');
  });
  it('keeps managed variables usable when no shared file is present', () => {
    io.exists.mockReturnValue(false);
    expect(loadHostingerEnvironment(cwd)).toBe(false);
  });
});
