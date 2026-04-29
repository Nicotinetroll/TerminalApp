export interface MoveEntry {
  from: string;
  to: string;
  san: string;
  ts: number;
}

export interface ChessGameState {
  id: string;
  whiteName: string;
  blackName: string | null;
  status: 'waiting' | 'active' | 'finished' | 'abandoned';
  fen: string;
  pgn: string;
  moves: MoveEntry[];
  moveCount: number;
  result: string | null;
  resultReason: string | null;
  drawOfferBy: string | null;
  isBot: boolean;
  botLevel: number | null;
  timeControl: number | null;
  whiteTimeLeft: number | null;
  blackTimeLeft: number | null;
  lastMoveAt: string | null;
  createdAt: string;
}

export interface CreateGameResponse {
  gameId: string;
  token: string;
  botToken?: string;
  color: 'white' | 'black';
  shareUrl: string;
}

export interface JoinGameResponse {
  token: string;
  color: 'white' | 'black';
  game: ChessGameState;
}

export interface MyGameEntry extends ChessGameState {
  myToken: string;
  myColor: 'white' | 'black';
}

export const BOT_LEVELS = [
  { level: 0, name: 'Drunk Intern', desc: "plays like it learned chess from a YouTube Short", elo: '~400', skill: 0, depth: 1 },
  { level: 1, name: 'Script Kiddie', desc: "knows the rules, not much else", elo: '~800', skill: 3, depth: 3 },
  { level: 2, name: 'Mid Dev', desc: "occasionally does something smart by accident", elo: '~1200', skill: 6, depth: 6 },
  { level: 3, name: 'Senior Engineer', desc: "will punish your mistakes", elo: '~1600', skill: 10, depth: 10 },
  { level: 4, name: 'Tech Lead', desc: "thinks 10 moves ahead, like in meetings", elo: '~2000', skill: 15, depth: 15 },
  { level: 5, name: 'Stockfish Daddy', desc: "you WILL lose. it's not a question.", elo: '~2500+', skill: 20, depth: 22 },
] as const;
