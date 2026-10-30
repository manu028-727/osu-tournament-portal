import { z } from 'zod';

const text = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (s) => !/[\x00-\x1f\x7f]/.test(s) && new TextEncoder().encode(s).length <= 300,
    'Use a single line, at most 300 UTF-8 bytes.',
  );
const channel = z.string().regex(/^#mp_[1-9]\d{0,9}$/);
export const ircPeer = z.string().regex(/^[a-zA-Z0-9_\[\]-]{1,32}$/);
const common = { id: z.uuid() };
export const ircClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), ticket: z.string().max(3000) }),
  z.object({
    type: z.literal('connect'),
    acknowledged: z.literal(true),
    password: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[\x21-\x7e]+$/),
  }),
  z.object({ type: z.literal('disconnect') }),
  z.object({ type: z.literal('join') }),
  z.object({ type: z.literal('query'), target: ircPeer }),
  z.object({ type: z.literal('close_query'), target: ircPeer }),
  z.object({ type: z.literal('part'), channel }),
  z.object({
    type: z.literal('chat'),
    ...common,
    target: z.union([z.literal('#osu'), ircPeer, channel]),
    text,
  }),
  z.object({
    type: z.literal('command'),
    ...common,
    target: channel,
    command: text,
    confirmed: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('make'),
    ...common,
    name: text,
    baseVersion: z.number().int().positive(),
    confirmed: z.literal(true),
  }),
  z.object({
    type: z.literal('resolve'),
    requestId: z.string().max(100),
    confirmed: z.literal(true),
  }),
]);
export type IrcClientMessage = z.infer<typeof ircClientMessage>;
export function lobbyFromResponse(sender: string, message: string) {
  if (
    sender.toLowerCase() !== 'banchobot' ||
    !/^Created (?:the )?(?:tournament )?match\b/i.test(message)
  )
    return null;
  const id = message.match(
    /https?:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/([1-9]\d{0,9})(?=$|[\s).])/i,
  )?.[1];
  if (!id || Number(id) > 2147483647) return null;
  return { url: `https://osu.ppy.sh/community/matches/${id}`, channel: `#mp_${id}` };
}
export function validateLobbyCommand(command: string, confirmed: boolean, creator: boolean) {
  if (!text.safeParse(command).success) throw new Error('Invalid command text.');
  const match = command.match(
    /^!mp (settings|name|invite|kick|addref|listrefs|map|mods|timer|aborttimer|start|abort|lock|unlock|close|set)(?: (.+))?$/i,
  );
  if (!match) throw new Error('Unsupported multiplayer command.');
  const verb = match[1].toLowerCase(),
    args = match[2] || '';
  if (
    ['start', 'abort', 'close', 'name', 'lock', 'unlock', 'set', 'kick'].includes(verb) &&
    !confirmed
  )
    throw new Error('Confirm this disruptive lobby command.');
  if (verb === 'addref' && !creator)
    throw new Error('Only the known lobby creator can add referees.');
  if (['name', 'invite', 'addref', 'map', 'mods', 'set'].includes(verb) && !args)
    throw new Error('This command requires parameters.');
  if (
    ['settings', 'listrefs', 'aborttimer', 'abort', 'lock', 'unlock', 'close'].includes(verb) &&
    args
  )
    throw new Error('Unexpected command parameters.');
  if (verb === 'map' && !/^[1-9]\d{0,9}(?: [0-3])?$/.test(args))
    throw new Error('Use a valid beatmap ID and optional game mode.');
  if (verb === 'kick' && !/^#[1-9]\d{0,9}$/.test(args))
    throw new Error('Select a registered osu! player ID.');
  if (['timer', 'start'].includes(verb) && args && !/^\d{1,4}$/.test(args))
    throw new Error('Use seconds between 0 and 9999.');
  if (verb === 'set' && !/^[0-3](?: [0-3](?: (?:[1-9]|1[0-6]))?)?$/.test(args))
    throw new Error('Invalid lobby rules.');
  return verb;
}
