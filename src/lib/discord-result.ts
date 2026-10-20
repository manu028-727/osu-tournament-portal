import countries from './referee-country-codes.json';
import type { Side } from './match-rules';
import type { MatchView } from './matches-types';

export type SpreadsheetResult = {
  id: string;
  stage: string;
  red: string;
  blue: string;
  scoreA: number | 'FF';
  scoreB: number | 'FF';
  bestOf: number;
  mp: string;
  redEmoji: string;
  blueEmoji: string;
  actions: { team: string; action: string; slot: string; winner: string }[];
};
export function countryEmoji(name: string, fallback: string) {
  const code = Object.entries(countries).find(
    ([country]) => country.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return code ? `:flag_${code.toLowerCase()}:` : fallback;
}

// Template!AB3 uses CHAR(13), including its asymmetric forfeit bold markers.
export function spreadsheetDiscordResult(
  m: SpreadsheetResult,
  options: { allowMissingMp?: boolean } = {},
): string {
  if (!m.id) return 'No Match ID';
  const header = `# __**${m.stage}: Match**__ \`${m.id}\``;
  if (m.scoreA === 'FF')
    return `${header}\r${m.redEmoji} ${m.red} | FF - **0** | ${m.blue} ${m.blueEmoji} **:first_place:**`;
  if (m.scoreB === 'FF')
    return `${header}\r:first_place: **${m.redEmoji} ${m.red} | **0** - FF | ${m.blue} ${m.blueEmoji}`;
  if (!m.mp && !options.allowMissingMp) return 'No MP Link';
  if (m.scoreA < (1 + m.bestOf) / 2 && m.scoreB < (1 + m.bestOf) / 2) return 'Match in Progress';
  const score =
    m.scoreA > m.scoreB
      ? `:first_place: **${m.redEmoji} ${m.red} | ${m.scoreA}** - ${m.scoreB} | ${m.blue} ${m.blueEmoji}`
      : `${m.redEmoji} ${m.red} | ${m.scoreA} - **${m.scoreB} | ${m.blue} ${m.blueEmoji}** :first_place:`;
  const emoji = (team: string) =>
    team === m.red || team === 'Red'
      ? m.redEmoji
      : team === m.blue || team === 'Blue'
        ? m.blueEmoji
        : ':grey_question:';
  const count = m.actions.filter((a) => a.slot !== '').length;
  const rundown = m.actions
    .slice(0, count)
    .map(
      (a) =>
        `${a.team ? `${emoji(a.team)} ${a.action.toLowerCase()}s` : ':purple_circle:'} \`\`${a.slot}\`\`${a.winner ? ` ↳ ${emoji(a.winner)} wins!` : ''}`,
    );
  return `${header}\r${score}${m.mp ? `\r**MP Link:** <${m.mp}>` : ''}${count ? `\r__**Match Rundown**__\r${rundown.join('\r')}` : ''}`;
}

export function matchResultData(m: MatchView): SpreadsheetResult {
  const team = (side: Side) => (side === 'A' ? 'Red' : 'Blue');
  const sequence = m.rules.draftSequence.flatMap((kind) => [kind, kind]);
  return {
    id: m.code,
    stage: m.stage.name,
    red: m.participants.A.name,
    blue: m.participants.B.name,
    scoreA: m.forfeitSide === 'A' ? 'FF' : m.scoreA,
    scoreB: m.forfeitSide === 'B' ? 'FF' : m.scoreB,
    bestOf: m.rules.bestOf,
    mp: m.lobbyUrl,
    redEmoji: m.rules.worldCup
      ? countryEmoji(m.participants.A.name, m.rules.redEmoji)
      : m.rules.redEmoji,
    blueEmoji: m.rules.worldCup
      ? countryEmoji(m.participants.B.name, m.rules.blueEmoji)
      : m.rules.blueEmoji,
    actions: m.actions
      .filter((a) => !a.voided)
      .map((a, index) => {
        const result = m.results.find((r) => !r.voided && r.actionId === a.id);
        const tb =
          a.kind === 'PICK' &&
          a.category === m.rules.tiebreakerCategory &&
          m.rules.enableTiebreaker;
        return {
          team: tb ? '' : team(a.side),
          action: a.kind === 'BAN' && sequence[index] === 'TB_BAN' ? 'TB Ban' : a.kind,
          slot: a.slotName,
          winner: result ? team(result.winnerSide) : '',
        };
      }),
  };
}
export function matchDiscordResult(m: MatchView) {
  if (!m.code) return 'No Match ID';
  if (m.status !== 'COMPLETED')
    return !m.forfeitSide && !m.lobbyUrl ? 'No MP Link' : 'Match in Progress';
  return spreadsheetDiscordResult(matchResultData(m), { allowMissingMp: true });
}
export function matchDiscordPreview(m: MatchView) {
  if (m.status === 'COMPLETED') return matchDiscordResult(m);
  const data = matchResultData(m),
    labels = { A: data.redEmoji, B: data.blueEmoji };
  const lines = m.actions
    .filter((a) => !a.voided)
    .map((a) => {
      const result = m.results.find((r) => !r.voided && r.actionId === a.id);
      return (
        labels[a.side] +
        ' ' +
        a.kind.toLowerCase() +
        's ``' +
        a.slotName +
        '``' +
        (result ? ' ↳ ' + labels[result.winnerSide] + ' wins!' : '')
      );
    });
  return [
    `# __**${data.stage}: Match**__ ` + '`' + data.id + '`',
    `${data.red} | ${m.scoreA} - ${m.scoreB} | ${data.blue}`,
    m.winnerSide ? 'Awaiting organizer confirmation' : 'Match in Progress',
    data.mp ? `**MP Link:** <${data.mp}>` : 'No MP Link',
    ...(lines.length ? ['__**Match Rundown**__', ...lines] : []),
  ].join('\r');
}

export function matchPing(
  stage: string,
  code: string,
  discordIds: string[] = [],
  qualifier = false,
) {
  const mentions = [...new Set(discordIds)]
    .filter((id) => /^\d{17,20}$/.test(id))
    .map((id) => `<@${id}>`)
    .join(' ');
  return `${mentions}\r${qualifier ? 'Qualifiers Match' : `${stage} - Match`} **${code}** is starting soon! Invites will be sent shortly!`;
}
