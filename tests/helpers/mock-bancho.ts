import { createServer, type Socket } from 'node:net';

export type MockBanchoOptions = {
  silentCreate?: boolean;
  strictRegistration?: boolean;
  password?: string | ((nickname: string) => string);
  registrationError?: {
    code: '464' | 'ERROR' | '432' | '433' | '461';
    reason: string;
    lateWelcome?: boolean;
  };
};
export function mockBancho(options: MockBanchoOptions = {}) {
  const sockets = new Set<Socket>();
  const lines: string[] = [];
  const registrations: { nickname: string; commands: string[]; passwordMatches: boolean }[] = [];
  let made = 100;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '',
      nick = '',
      pass = '',
      registered = false,
      rejected = false;
    const registration = { nickname: '', commands: [] as string[], passwordMatches: false };
    registrations.push(registration);
    const say = (line: string) => socket.write(line + '\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (rejected) continue;
        if (!line.startsWith('PASS ')) lines.push(line);
        const command = line.split(' ', 1)[0];
        if (['CAP', 'PASS', 'NICK', 'USER'].includes(command)) registration.commands.push(command);
        if (line.startsWith('CAP ') && options.strictRegistration) {
          say(':mock 421 * CAP :Unknown command');
          rejected = true;
          socket.end();
          continue;
        }
        if (line.startsWith('PASS ')) pass = line.slice(5).replace(/^:/, '');
        if (line.startsWith('NICK ')) nick = line.slice(5).replace(/^:/, '');
        if (line.startsWith('CAP LS')) say(`:mock CAP ${nick || '*'} LS :`);
        if (line.startsWith('USER ') && !registered) {
          registration.nickname = nick;
          registration.passwordMatches =
            pass ===
            (typeof options.password === 'function'
              ? options.password(nick)
              : (options.password ?? 'separate-test-irc-password'));
          pass = '';
          if (
            options.strictRegistration &&
            (registration.commands.join(',') !== 'PASS,NICK,USER' ||
              line !== `USER ${nick} 0 * :${nick}`)
          ) {
            say(`:mock 461 ${nick} USER :Invalid registration format`);
            rejected = true;
            socket.end();
            continue;
          }
          if (!registration.passwordMatches) {
            say(`:mock 464 ${nick} :Password incorrect`);
            socket.end();
            continue;
          }
          if (options.registrationError) {
            const { code, reason, lateWelcome } = options.registrationError;
            // Deliberately allow hostile replies in tests; the gateway must never log their text.
            say(`:BanchoBot!bot@mock NOTICE ${nick} :${reason}`);
            say(code === 'ERROR' ? `ERROR :${reason}` : `:mock ${code} ${nick} :${reason}`);
            if (lateWelcome) say(`:mock 001 ${nick} :Late welcome`);
            rejected = true;
            socket.end();
            continue;
          }
          registered = true;
          pass = '';
          say(`:mock 001 ${nick} :Welcome`);
          say('PING :keepalive');
        }
        if (line.startsWith('PING ')) say(`PONG ${line.slice(5)}`);
        if (line.startsWith('JOIN '))
          say(`:${nick}!user@mock JOIN :${line.slice(5).replace(/^:/, '')}`);
        if (line.startsWith('PART ')) say(`:${nick}!user@mock PART ${line.split(' ')[1]}`);
        const privmsg = line.match(/^PRIVMSG ([^ ]+) :?(.*)$/);
        if (privmsg) {
          const [, target, text] = privmsg;
          if (target === 'BanchoBot' && text.startsWith('!mp make ') && !options.silentCreate)
            say(
              `:BanchoBot!bot@mock PRIVMSG ${nick} :Created the tournament match https://osu.ppy.sh/mp/${++made} ${text.slice(9)}`,
            );
          else if (text === '!mp settings')
            say(`:BanchoBot!bot@mock PRIVMSG ${target} :Room name: Test`);
          else if (text.startsWith('!mp map '))
            say(
              `:BanchoBot!bot@mock PRIVMSG ${target} :Beatmap changed to: Test (https://osu.ppy.sh/b/${text.split(' ')[2]})`,
            );
          else if (!text.startsWith('!mp '))
            say(`:Other_player!user@mock PRIVMSG ${target} :Reply: ${text}`);
        }
        if (line.startsWith('QUIT')) socket.end();
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    server,
    sockets,
    lines,
    registrations,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
