import { afterEach, describe, it, expect, vi } from 'vitest';
import { assertInstanceDatabase, assertTestDatabase } from '../src/lib/instance';
afterEach(() => vi.unstubAllEnvs());
describe('installation database boundaries', () => {
  it('requires explicit names for non-default installation databases', () => {
    vi.stubEnv('APP_DATABASE_NAME', 'managed_database');
    expect(() =>
      assertInstanceDatabase('postgresql://user:secret@localhost/managed_database'),
    ).not.toThrow();
    expect(() => assertInstanceDatabase('postgresql://user:secret@localhost/unrelated')).toThrow();
  });
  it('never accepts an installation database as the automated test target', () => {
    expect(() =>
      assertTestDatabase('postgresql://user:secret@localhost/tournament_platform'),
    ).toThrow();
    expect(() =>
      assertTestDatabase('postgresql://user:secret@localhost/tournament_platform_test'),
    ).not.toThrow();
  });
});
