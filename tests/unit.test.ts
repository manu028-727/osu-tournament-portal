import { describe, it, expect } from 'vitest';
import { cleanHtml, tableOfContents } from '../src/lib/rich-text';
import { parseImport, actionSchema, safeUrl } from '../src/lib/validation';
import {
  can,
  assertPermission,
  assertRoleGrant,
  DEFAULT_ROLES,
  type Actor,
} from '../src/lib/permissions';
const pooler: Actor = {
  id: 'pooler',
  osuId: 1,
  username: 'test',
  avatarUrl: '',
  permissions: DEFAULT_ROLES.Pooler,
  roles: [],
};
describe('rich text safety', () => {
  it('removes scripts, handlers, javascript URLs, iframe and unsafe images', () => {
    const html = cleanHtml(
      '<script>alert(1)</script><p onclick="bad()">Safe</p><a href="javascript:alert(1)">link</a><iframe src="https://x.test"></iframe><img src="data:image/svg+xml,bad"><img src="/api/media/image" onerror="bad()">',
    );
    expect(html).toContain('<p>Safe</p>');
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:|iframe|data:image/);
    expect(html).toContain('/api/media/image');
  });
  it('preserves rich formatting and assigns stable heading anchors', () => {
    const html = cleanHtml(
      '<h2>General <em>rules</em></h2><h3>Fair play</h3><table><tbody><tr><td>Test</td></tr></tbody></table><u>underline</u>',
    );
    expect(tableOfContents(html)).toEqual([
      { id: 'section-1', text: 'General rules', level: 2 },
      { id: 'section-2', text: 'Fair play', level: 3 },
    ]);
    expect(cleanHtml(html)).toBe(html);
    expect(html).toContain('<table>');
    expect(html).toContain('<u>underline</u>');
  });
});
describe('heading labels', () => {
  it('decodes entities once without rewriting rich text or interpreting encoded tags', () => {
    const source = '<h2>Teams &amp; Players <em>&#x1f600;</em> &lt;code&gt; &amp;amp;</h2>';
    const html = cleanHtml(source);
    expect(tableOfContents(html)[0].text).toBe('Teams & Players 😀 <code> &amp;');
    expect(html).toContain('&lt;code&gt;');
    expect(cleanHtml(html)).toBe(html);
  });
});
describe('validation', () => {
  it('parses IDs and slot mappings without losing custom mod categories', () => {
    expect(parseImport('123\n456', 'NM')).toEqual([
      { name: 'NM1', category: 'NM', beatmapId: 123 },
      { name: 'NM2', category: 'NM', beatmapId: 456 },
    ]);
    expect(parseImport('4K1: 50', 'NM')[0]).toEqual({ name: '4K1', category: '4K', beatmapId: 50 });
    expect(parseImport('HD1: 42\nEZ2, 99\nTB = 100', 'NM')).toEqual([
      { name: 'HD1', category: 'HD', beatmapId: 42 },
      { name: 'EZ2', category: 'EZ', beatmapId: 99 },
      { name: 'TB', category: 'TB', beatmapId: 100 },
    ]);
    expect(parseImport('https://osu.ppy.sh/beatmaps/4724670\nHD2\t12345', 'NM')).toEqual([
      { name: 'NM1', category: 'NM', beatmapId: 4724670 },
      { name: 'HD2', category: 'HD', beatmapId: 12345 },
    ]);
  });
  it('reports malformed IDs and bounds imports', () => {
    expect(() => parseImport('123\nwrong', 'NM')).toThrow('Line 2');
    expect(() => parseImport(Array(101).fill('1').join('\n'), 'NM')).toThrow('100');
    expect(() => parseImport('99999999999999', 'NM')).toThrow();
  });
  it('validates bulk schedule patches without accepting ambiguous or duplicate selections', () => {
    expect(
      actionSchema.safeParse({
        type: 'matches.bulk.schedule',
        matches: [
          { id: 'one', baseVersion: 1 },
          { id: 'two', baseVersion: 4 },
        ],
        shiftMinutes: -60,
        refereeIds: ['ref'],
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: 'matches.bulk.schedule',
        matches: [
          { id: 'one', baseVersion: 1 },
          { id: 'one', baseVersion: 1 },
        ],
        refereeIds: [],
      }).success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({
        type: 'matches.bulk.schedule',
        matches: [{ id: 'one', baseVersion: 1 }],
        shiftMinutes: 30,
        scheduledAt: null,
      }).success,
    ).toBe(false);
  });
  it('rejects unsafe links, unknown operations, arbitrary permissions and invalid branding', () => {
    for (const url of ['javascript:alert(1)', '//evil.test', 'data:text/html,bad', '/\\evil.test'])
      expect(safeUrl.safeParse(url).success).toBe(false);
    expect(safeUrl.safeParse('/mappools').success).toBe(true);
    expect(actionSchema.safeParse({ type: 'user.makeOwner' }).success).toBe(false);
    expect(
      actionSchema.safeParse({
        type: 'role.save',
        name: 'Test',
        description: '',
        permissions: ['system.root'],
      }).success,
    ).toBe(false);
  });
});
describe('permissions', () => {
  it('keeps rich-text navigation inside its tournament without rewriting external links', () => {
    const html = cleanHtml(
      '<p><a href="/rules">Rules</a><a href="https://osu.ppy.sh">osu!</a><a href="#section-1">Section</a></p>',
      '/t/spring',
    );
    expect(html).toContain('href="/t/spring/rules"');
    expect(html).toContain('href="https://osu.ppy.sh"');
    expect(html).toContain('href="#section-1"');
  });
  it('denies guests, grants only the explicit permissions and separates publishing', () => {
    expect(can(null, 'mappools.edit')).toBe(false);
    expect(() => assertPermission(null, 'mappools.edit')).toThrow('Sign in');
    expect(() => assertPermission(pooler, 'mappools.publish')).toThrow('permission');
    expect(can(pooler, 'mappools.edit')).toBe(true);
    expect(DEFAULT_ROLES['Content Editor']).not.toContain('rules.publish');
    expect(DEFAULT_ROLES.Player).toEqual([]);
  });
  it('prevents self-role mutation and permission escalation', () => {
    expect(() => assertRoleGrant(pooler, 'pooler', [])).toThrow('own roles');
    expect(() => assertRoleGrant(pooler, 'someone', ['roles.manage'])).toThrow('do not hold');
    expect(() => assertRoleGrant(pooler, 'someone', [], true)).toThrow('Only an Owner');
  });
});
