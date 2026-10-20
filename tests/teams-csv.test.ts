import { describe, it, expect } from 'vitest';
import { parseTeamCsv, exportTeamCsv } from '../src/lib/teams-csv';
describe('team CSV safety', () => {
  it('parses quoted fields, Italian text, and multiline descriptions', () => {
    const result = parseTeamCsv(
      'team_name,team_slug,description,osu_id,captain,substitute\r\n"Team, Italia",italia,"Prima riga\nSeconda riga",123,true,false\r\n"Team, Italia",italia,"Prima riga\nSeconda riga",124,false,true',
    );
    expect(result.errors).toEqual([]);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].members[1]).toMatchObject({ osuId: 124, substitute: true });
    expect(result.teams[0].description).toContain('\n');
  });
  it('rejects duplicate players and malformed or incomplete rosters', () => {
    const result = parseTeamCsv(
      'team_name,osu_id,captain\nA,123,true\nB,123,true\nC,not-an-id,nope',
    );
    expect(result.errors.some((e) => e.includes('more than once'))).toBe(true);
    expect(result.errors.some((e) => e.includes('invalid osu_id'))).toBe(true);
    expect(parseTeamCsv('team_name,osu_id\nA,123').errors.join()).toContain('captain');
  });
  it('prevents formula injection in exported CSV cells', () => {
    const csv = exportTeamCsv([
      {
        name: '=HYPERLINK("bad")',
        slug: 'test',
        format: 'TEAM',
        description: '@danger',
        position: 0,
        seed: null,
        members: [{ osuId: 123, captain: true, substitute: false }],
      },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@danger");
  });
  it('validates solo entries and captain/substitute conflicts', () => {
    expect(
      parseTeamCsv(
        'team_name,format,osu_id,captain,substitute\nA,INDIVIDUAL,123,true,true',
      ).errors.join(),
    ).toContain('substitute');
    expect(
      parseTeamCsv(
        'team_name,format,osu_id,captain\nA,INDIVIDUAL,123,true\nA,INDIVIDUAL,124,false',
      ).errors.join(),
    ).toContain('exactly one player');
  });
});
