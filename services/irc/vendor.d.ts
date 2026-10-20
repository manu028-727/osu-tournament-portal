declare module 'irc-framework' {
  import { EventEmitter } from 'node:events';
  import type { Socket } from 'node:net';
  export class Client extends EventEmitter {
    options: Record<string, unknown>;
    user: { nick: string };
    connection: {
      options: Record<string, unknown>;
      end(): void;
      transport?: { options: Record<string, unknown>; socket?: Socket; incoming_buffer?: Buffer };
    };
    connect(options: Record<string, unknown>): void;
    say(target: string, message: string): void;
    join(channel: string): void;
    part(channel: string, message?: string): void;
    quit(message?: string): void;
  }
}
