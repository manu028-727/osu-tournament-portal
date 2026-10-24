import Papa from 'papaparse';
import { slugify } from './utils';
import { teamSaveSchema, type TeamFields } from './teams-validation';
export const TEAM_CSV_COLUMNS = [
  'team_name',
  'team_slug',
  'format',
  'description',
  'seed',
  'position',
  'osu_id',
  'captain',
  'substitute',
];
export function parseTeamCsv(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) =>
      h
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase(),
  });
  const errors = parsed.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  if (!parsed.meta.fields?.includes('team_name') || !parsed.meta.fields.includes('osu_id'))
    errors.push('Required columns: team_name, osu_id.');
  if (parsed.data.length > 500) errors.push('Import at most 500 player rows at a time.');
  const grouped = new Map<string, TeamFields>();
  const used = new Set<number>();
  const flag = (v: string | undefined, row: number) => {
    if (!v || /^(false|0|no)$/i.test(v.trim())) return false;
    if (/^(true|1|yes)$/i.test(v.trim())) return true;
    errors.push(`Row ${row}: captain/substitute must be true or false.`);
    return false;
  };
  parsed.data.slice(0, 500).forEach((row, index) => {
    const line = index + 2,
      name = row.team_name?.trim() || '',
      slug = row.team_slug?.trim() || slugify(name);
    if (!/^\d+$/.test(row.osu_id?.trim() || '')) errors.push(`Row ${line}: invalid osu_id.`);
    const osuId = Number(row.osu_id);
    if (used.has(osuId)) errors.push(`Row ${line}: player ${osuId} appears more than once.`);
    used.add(osuId);
    const fields = {
      name,
      slug,
      format: (row.format?.trim().toUpperCase() || 'TEAM') as TeamFields['format'],
      description: row.description?.trim() || '',
      seed: row.seed?.trim() ? Number(row.seed) : null,
      position: row.position?.trim() ? Number(row.position) : grouped.size,
      logoImageId: null,
      members: [],
    };
    let team = grouped.get(slug);
    if (
      team &&
      (team.name !== name ||
        team.format !== fields.format ||
        team.seed !== fields.seed ||
        team.description !== fields.description)
    )
      errors.push(`Row ${line}: inconsistent details for team ${slug}.`);
    if (!team) {
      team = fields;
      grouped.set(slug, team);
    }
    team.members.push({
      osuId,
      captain: flag(row.captain, line),
      substitute: flag(row.substitute, line),
    });
  });
  for (const team of grouped.values()) {
    const valid = teamSaveSchema.safeParse({ type: 'team.save', ...team });
    if (!valid.success)
      errors.push(
        `${team.name || team.slug || 'Team'}: ${valid.error.issues.map((i) => i.message).join('; ')}`,
      );
  }
  if (!grouped.size) errors.push('No teams found.');
  return { teams: [...grouped.values()], errors };
}
export function exportTeamCsv(
  teams: {
    name: string;
    slug: string;
    format: string;
    description: string;
    seed: number | null;
    position: number;
    members: { osuId: number; captain: boolean; substitute: boolean }[];
  }[],
  header = true,
) {
  return Papa.unparse(
    {
      fields: TEAM_CSV_COLUMNS,
      data: teams.flatMap((team) =>
        (team.members.length ? team.members : [null]).map((member) => [
          team.name,
          team.slug,
          team.format,
          team.description,
          team.seed ?? '',
          team.position,
          member?.osuId ?? '',
          member?.captain ?? '',
          member?.substitute ?? '',
        ]),
      ),
    },
    { escapeFormulae: true, header },
  );
}
