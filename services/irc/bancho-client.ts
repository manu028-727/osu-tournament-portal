import { Client } from 'irc-framework';
import { ircNickname } from '../../src/lib/irc-security';

export class BanchoClient extends Client {
  // Bancho uses basic server-password registration, not IRCv3 CAP/SASL negotiation.
  override registerToNetwork() {
    const nick = ircNickname(String(this.options.nick));
    this.raw('PASS', String(this.options.password));
    this.raw('NICK', nick);
    this.raw(`USER ${nick} 0 * :${nick}`);
  }
}
