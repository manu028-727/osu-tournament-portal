export type IrcIdentity = {
  userId: string;
  username: string;
  sessionHash: string;
  tournamentId: string;
  matchId: string;
  expires: number;
  nonce: string;
};
export type IrcChatMessage = {
  id: string;
  target: string;
  sender: string;
  text: string;
  at: string;
};
export type IrcDelivery = {
  id: string;
  command: string;
  target: string;
  state: 'sending' | 'awaiting' | 'confirmed' | 'failed' | 'unknown';
  note?: string;
};
export type IrcLobby = {
  requestId: string;
  matchId: string;
  tournamentId: string;
  url: string;
  channel: string;
};
export type IrcConnectionDiagnostic = {
  nickname: string;
  stage: 'validation' | 'identity' | 'connecting' | 'registration' | 'connected';
  source: 'gateway' | 'bancho' | 'transport';
  code: string;
};
export type IrcServerEvent =
  | { type: 'resolved'; requestId: string }
  | {
      type: 'state';
      state: 'disconnected' | 'connecting' | 'connected';
      username: string;
      channels: string[];
      messages: IrcChatMessage[];
      deliveries: IrcDelivery[];
      lobbies: IrcLobby[];
    }
  | { type: 'message'; message: IrcChatMessage }
  | { type: 'delivery'; delivery: IrcDelivery }
  | { type: 'lobby'; lobby: IrcLobby }
  | { type: 'error'; error: string; diagnostic?: IrcConnectionDiagnostic };
