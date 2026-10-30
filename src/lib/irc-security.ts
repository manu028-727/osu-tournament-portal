import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IrcIdentity } from './irc-types';

const identitySchema = z.object({
  kind: z.enum(['match', 'qualifier']).optional(),
  userId: z.string().min(1).max(100),
  username: z.string().min(1).max(100),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
  tournamentId: z.string().min(1).max(100),
  matchId: z.string().min(1).max(100),
  expires: z.number(),
  nonce: z.uuid(),
});
export function ircSecret() {
  const secret = process.env.IRC_GATEWAY_SECRET || '';
  if (secret.length < 64)
    throw new Error('IRC_GATEWAY_SECRET must contain at least 64 random characters.');
  return secret;
}
export const signature = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('base64url');
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signTicket(claims: IrcIdentity, secret: string) {
  const value = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${value}.${signature(value, secret)}`;
}
export function readTicket(ticket: string, secret: string): IrcIdentity {
  if (ticket.length > 3000) throw new Error('Invalid ticket');
  const parts = ticket.split('.');
  const [value, signed] = parts;
  if (parts.length !== 2 || !value || !signed || !constantEqual(signature(value, secret), signed))
    throw new Error('Invalid ticket');
  const claims = identitySchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (claims.expires < Date.now() || claims.expires > Date.now() + 65000)
    throw new Error('Expired ticket');
  return claims;
}
export function rpcHeaders(body: string, secret: string) {
  const time = String(Date.now()),
    nonce = randomUUID();
  return {
    'content-type': 'application/json',
    'x-irc-time': time,
    'x-irc-nonce': nonce,
    'x-irc-signature': signature(`${time}.${nonce}.${body}`, secret),
  };
}
export function verifyRpc(body: string, headers: Headers, secret: string) {
  const time = headers.get('x-irc-time') || '',
    nonce = headers.get('x-irc-nonce') || '';
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 30000 ||
    !z.uuid().safeParse(nonce).success ||
    !constantEqual(
      signature(`${time}.${nonce}.${body}`, secret),
      headers.get('x-irc-signature') || '',
    )
  )
    throw new Error('Invalid gateway signature');
  return nonce;
}
export function ircNickname(username: string) {
  const nick = username.replace(/ /g, '_');
  if (!nick || Buffer.byteLength(nick) > 100 || /[\x00-\x20\x7f,:]/.test(nick))
    throw new Error('This osu! username cannot be used for IRC.');
  return nick;
}
