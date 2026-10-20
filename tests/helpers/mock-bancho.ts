import { createServer, type Socket } from 'node:net';

export function mockBancho(options: { silentCreate?: boolean } = {}) {
  const sockets = new Set<Socket>();
  const lines: string[] = [];
  let made = 100;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '',
      nick = '',
      pass = '',
      registered = false;
    const say = (line: string) => socket.write(line + '\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line.startsWith('PASS ')) lines.push(line);
        if (line.startsWith('PASS ')) pass = line.slice(5).replace(/^:/, '');
        if (line.startsWith('NICK ')) nick = line.slice(5).replace(/^:/, '');
        if (line.startsWith('CAP LS')) say(`:mock CAP ${nick || '*'} LS :`);
        if (line.startsWith('USER ') && !registered) {
          if (pass !== 'separate-test-irc-password') {
            say(`:mock 464 ${nick} :Password incorrect`);
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
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
