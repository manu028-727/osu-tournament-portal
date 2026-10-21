declare module 'irc-framework' {
  import { EventEmitter } from 'node:events';
  import type { Socket } from 'node:net';
  export class Client extends EventEmitter {
    options: Record<string, unknown>;
    raw_middleware: {
      use(
        handler: (
          command: string,
          message: { params: string[] },
          line: string,
          client: Client,
          next: () => void,
        ) => void,
      ): void;
    };
    user: { nick: string };
    connection: {
      options: Record<string, unknown>;
      end(): void;
      transport?: { options: Record<string, unknown>; socket?: Socket; incoming_buffer?: Buffer };
    };
    connect(options: Record<string, unknown>): void;
    registerToNetwork(): void;
    raw(input: string, ...params: (string | number)[]): void;
    say(target: string, message: string): void;
    join(channel: string): void;
    part(channel: string, message?: string): void;
    quit(message?: string): void;
  }
}
