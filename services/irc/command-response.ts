const modNames: Record<string, string> = {
  nf: 'nf',
  nofail: 'nf',
  ez: 'ez',
  easy: 'ez',
  hd: 'hd',
  hidden: 'hd',
  hr: 'hr',
  hardrock: 'hr',
  sd: 'sd',
  suddendeath: 'sd',
  dt: 'dt',
  doubletime: 'dt',
  ht: 'ht',
  halftime: 'ht',
  nc: 'nc',
  nightcore: 'nc',
  fl: 'fl',
  flashlight: 'fl',
  so: 'so',
  spunout: 'so',
  pf: 'pf',
  perfect: 'pf',
  fi: 'fi',
  fadein: 'fi',
  mr: 'mr',
  mirror: 'mr',
};

function mods(value: string, separator: RegExp): string[] | null {
  const result: string[] = [];
  for (const name of value.split(separator)) {
    const key = name.trim().toLowerCase().replace(/ /g, '');
    if (key === 'none' || key === 'nomod') continue;
    if (!Object.hasOwn(modNames, key)) return null;
    result.push(modNames[key]);
  }
  return [...new Set(result)].sort();
}

function duration(value: string): number | null {
  const parts = value.matchAll(/(\d+) (hours?|minutes?|seconds?)/g);
  let seconds = 0;
  for (const [, count, unit] of parts)
    seconds +=
      Number(count) * (unit.startsWith('hour') ? 3600 : unit.startsWith('minute') ? 60 : 1);
  return /^(?:\d+ (?:hours?|minutes?|seconds?))(?: and \d+ (?:minutes?|seconds?))*$/.test(value)
    ? seconds
    : null;
}

// Bancho has no request IDs. Only match a known reply to the current command's
// parameters; arbitrary bot chatter or countdown reminders are not receipts.
export function commandAcknowledgement(command: string, text: string): string | null {
  const parsed = command.match(/^!mp (\w+)(?: (.+))?$/i);
  if (!parsed) return null;
  const verb = parsed[1].toLowerCase();
  const args = parsed[2] || '';
  if (verb === 'settings' && /^Room name:/i.test(text)) return 'Lobby settings received.';
  if (verb === 'listrefs' && /^Match referees:\s*$/i.test(text))
    return 'BanchoBot returned the referee list.';
  if (verb === 'map') {
    if (!/^[1-9]\d{0,9}(?: [0-3])?$/.test(args)) return null;
    const id = args.split(' ')[0];
    if (
      /^(?:Changed beatmap to\b|Beatmap changed to:)/i.test(text) &&
      new RegExp(`https?://osu\\.ppy\\.sh/(?:b|beatmaps)/${id}(?=$|[\\s)#?])`, 'i').test(text)
    )
      return 'Beatmap ID acknowledged by BanchoBot.';
  }
  if (verb === 'mods') {
    const requestedFreeMod = /(?:^|\s)freemod(?:\s|$)/i.test(args);
    const requested = mods(args.replace(/(?:^|\s)freemod(?=\s|$)/gi, ' ').trim() || 'None', /\s+/);
    if (!requested) return null;
    const reply = text.match(/^Enabled (.+), (enabled|disabled) FreeMod\.?$/i);
    if (reply) {
      const actual = mods(reply[1], /,\s*/);
      if (
        actual &&
        actual.join(',') === requested.join(',') &&
        requestedFreeMod === (reply[2].toLowerCase() === 'enabled')
      )
        return 'Mod settings acknowledged by BanchoBot.';
    }
  }
  if (verb === 'timer') {
    const reply = text.match(/^Countdown ends in (.+?)\.?$/i);
    if (reply && duration(reply[1].toLowerCase()) === Number(args || 30))
      return 'BanchoBot acknowledged the requested countdown duration.';
  }
  return null;
}
