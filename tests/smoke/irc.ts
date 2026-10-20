import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_ROLES } from '../../src/lib/permissions';

if (process.env.ALLOW_ISOLATED_CONTAINER_TESTS !== 'yes')
  throw new Error('Explicit isolated staging fixtures only.');
const databaseUrl = new URL(process.env.DATABASE_URL!);
if (!['/tournament_platform_test', '/platform_onboarding_test'].includes(databaseUrl.pathname))
  throw new Error('Only dedicated test databases are accepted.');
if (process.env.MIGRATION_DATABASE_HOST) databaseUrl.hostname = process.env.MIGRATION_DATABASE_HOST;
const origin = process.env.APP_URL || 'https://localhost:3443';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('QA browser target must be loopback.');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl.toString() }),
});
const prefix = `irc-qa-${randomUUID()}`,
  userIds: string[] = [];
let matchId = '',
  roleId = '',
  browser: Browser | undefined;
await mkdir('.data/qa', { recursive: true });
try {
  const source = await db.match.findFirstOrThrow({
    where: { poolRevisionId: { not: null } },
    include: {
      poolRevision: { include: { slots: { orderBy: { position: 'asc' } } } },
      stage: true,
    },
  });
  const tournament = await db.tournament.findUniqueOrThrow({ where: { id: source.tournamentId } });
  const role = await db.role.create({
    data: {
      name: prefix,
      tournamentId: source.tournamentId,
      permissions: {
        create: DEFAULT_ROLES.Referee.filter(
          (key) => !['matches.manage', 'matches.manage_all'].includes(key),
        ).map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  roleId = role.id;
  const tokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({
      data: {
        username: i ? 'Ref B' : 'Ref A',
        osuId: 1700000000 + Math.floor(Math.random() * 100000000),
        avatarUrl: '',
        profileUrl: '',
        roles: { create: { roleId: role.id, tournamentId: source.tournamentId } },
      },
    });
    userIds.push(user.id);
    const token = randomBytes(32).toString('base64url');
    tokens.push(token);
    await db.session.create({
      data: {
        id: createHash('sha256').update(token).digest('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
  }
  const map = source.poolRevision!.slots[0];
  const match = await db.match.create({
    data: {
      code: `IRCQA-${Date.now() % 1000000}`,
      tournamentId: source.tournamentId,
      stageId: source.stageId,
      poolRevisionId: source.poolRevisionId,
      participants: source.participants as Prisma.InputJsonValue,
      rules: source.rules as Prisma.InputJsonValue,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      notes: prefix,
      assignments: { create: { userId: userIds[0] } },
      actions: {
        create: {
          sequence: 1,
          kind: 'PICK',
          side: 'A',
          slotName: map.name,
          category: map.category,
          actorId: userIds[0],
        },
      },
    },
  });
  matchId = match.id;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: origin.startsWith('https:') ? '__Host-tournament_session' : 'tournament_session',
      value: tokens[0],
      url: origin,
      secure: origin.startsWith('https:'),
    },
  ]);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const path = `/t/${tournament.slug}/admin/referee/${match.id}`;
  await page.goto(origin + path);
  await page.locator('summary').filter({ hasText: 'Bancho IRC' }).click();
  await expect(page.getByLabel('IRC security notice')).toContainText('unencrypted');
  await page.getByRole('button', { name: 'Open IRC', exact: true }).click();
  const connect = page.getByRole('button', { name: 'Connect to Bancho', exact: true });
  await expect(connect).toBeDisabled();
  const password = 'separate-test-irc-password';
  await page.getByLabel('Separate osu! IRC password', { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: /I understand the unencrypted/ }).check();
  await connect.click();
  await expect(page.getByRole('tab', { name: '#osu', exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Message #osu', exact: true })
    .fill('<script>window.ircInjected=true</script>');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Reply: <script>');
  assert.equal(
    await page.evaluate(() => (window as unknown as { ircInjected?: boolean }).ircInjected),
    undefined,
  );
  assert.equal(await page.getByRole('log').locator('script').count(), 0);
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await page.getByLabel('Lobby name', { exact: true }).fill('QA isolated match');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: `Link to match ${match.code}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect
    .poll(async () => (await db.match.findUniqueOrThrow({ where: { id: match.id } })).multiplayerId)
    .toBeGreaterThan(0);
  const saved = await db.match.findUniqueOrThrow({ where: { id: match.id } });
  const channel = `#mp_${saved.multiplayerId}`;
  await page.getByRole('tab', { name: channel, exact: true }).click();
  await page.getByRole('button', { name: 'Set map', exact: true }).click();
  await expect(page.getByLabel('Command delivery history')).toContainText(
    'Beatmap ID acknowledged',
  );
  await page.getByRole('button', { name: 'Set mods', exact: true }).click();
  await expect(page.getByLabel('Command delivery history')).toContainText('unknown', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Command delivery history')).toContainText(
    'Lobby settings received',
  );
  assert.equal(await db.ircLobbyRequest.count({ where: { matchId } }), 1);
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  assert.ok(!storage.includes(password));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `.data/qa/docker-irc-${width}.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Overflow at ${width}`,
    );
  }
  const observing = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 900 },
  });
  await observing.addCookies([
    {
      name: origin.startsWith('https:') ? '__Host-tournament_session' : 'tournament_session',
      value: tokens[1],
      url: origin,
      secure: origin.startsWith('https:'),
    },
  ]);
  const observer = await observing.newPage();
  await observer.goto(origin + path);
  await observer.locator('summary').filter({ hasText: 'Bancho IRC' }).click();
  await observer.getByRole('button', { name: 'Open IRC', exact: true }).click();
  await observer.getByLabel('Separate osu! IRC password', { exact: true }).fill(password);
  await observer.getByRole('checkbox', { name: /I understand the unencrypted/ }).check();
  await observer.getByRole('button', { name: 'Connect to Bancho', exact: true }).click();
  await expect(observer.getByRole('tab', { name: '#osu', exact: true })).toBeVisible();
  await observer.getByRole('button', { name: 'Join lobby', exact: true }).click();
  await expect(observer.getByRole('tab', { name: channel, exact: true })).toBeVisible();
  await expect(observer.getByRole('button', { name: 'Set map', exact: true })).toBeDisabled();
  const denied = await observer.evaluate(
    async ({ matchId, slug, channel }) => {
      const response = await fetch(`/api/irc/ticket?tournament=${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      });
      const ticket = await response.json();
      if (!response.ok)
        throw new Error(`Ticket request failed: ${response.status} ${ticket.error}`);
      return new Promise<string>((resolve, reject) => {
        const seen: string[] = [];
        const timer = setTimeout(
          () => reject(new Error(`Missing authorization reply: ${seen.join(', ')}`)),
          15000,
        );
        const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/irc/socket`);
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('QA WebSocket connection failed'));
        };
        ws.onclose = () => {
          clearTimeout(timer);
          reject(new Error(`QA WebSocket closed: ${seen.join(', ')}`));
        };
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: ticket.ticket }));
        let sent = false;
        ws.onmessage = ({ data }) => {
          const event = JSON.parse(data);
          seen.push(event.type);
          if (event.type === 'state' && !sent) {
            sent = true;
            ws.send(
              JSON.stringify({
                type: 'command',
                id: crypto.randomUUID(),
                target: channel,
                command: '!mp start 5',
                confirmed: true,
              }),
            );
          } else if (event.type === 'error') {
            clearTimeout(timer);
            ws.close();
            resolve(event.error);
          }
        };
      });
    },
    { matchId, slug: tournament.slug, channel },
  );
  assert.match(denied, /read only/i);
  const gatewayContainer = process.env.QA_GATEWAY_CONTAINER;
  if (gatewayContainer) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(gatewayContainer) ||
      !/^platform-(?:qa|onboarding)-/.test(gatewayContainer)
    )
      throw new Error('Use only an explicitly isolated QA container.');
    execFileSync('docker', ['restart', gatewayContainer]);
    await expect
      .poll(() => {
        try {
          execFileSync(
            'docker',
            [
              'exec',
              gatewayContainer,
              'node',
              '-e',
              "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ],
            { stdio: 'ignore' },
          );
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Open IRC', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open IRC', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: /I understand the unencrypted/ }),
    ).not.toBeChecked();
    await page.getByLabel('Separate osu! IRC password', { exact: true }).fill(password);
    await page.getByRole('checkbox', { name: /I understand the unencrypted/ }).check();
    await page.getByRole('button', { name: 'Connect to Bancho', exact: true }).click();
    await expect(page.getByRole('tab', { name: '#osu', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
    await expect(page.getByRole('tab', { name: channel, exact: true })).toBeVisible();
    assert.equal(await db.ircLobbyRequest.count({ where: { matchId } }), 1);
    const transcript = execFileSync('docker', [
      'exec',
      gatewayContainer,
      'node',
      '-e',
      "fetch('http://mock-bancho:8081/transcript').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))",
    ]).toString();
    assert.ok(!transcript.includes('PASS '));
    assert.ok(!transcript.includes('!mp close'));
    assert.ok(transcript.includes('PRIVMSG BanchoBot :!mp make QA isolated match'));
  }
  const final = await db.match.findUniqueOrThrow({
    where: { id: matchId },
    include: { actions: true },
  });
  assert.equal(final.scoreA, 0);
  assert.equal(final.scoreB, 0);
  assert.equal(final.actions.length, 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Browser IRC: HTTPS/WSS, explicit warning, private lobby creation/link, map/mod/settings commands, safe chat, read-only denial, responsive layout and restart recovery passed against mock Bancho.',
  );
} finally {
  await browser?.close();
  if (matchId) {
    await db.auditLog.deleteMany({ where: { entityId: matchId } });
    await db.match.deleteMany({ where: { id: matchId } });
  }
  await db.rateLimit.deleteMany({
    where: { OR: userIds.map((id) => ({ key: { contains: id } })) },
  });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  if (roleId) await db.role.delete({ where: { id: roleId } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
