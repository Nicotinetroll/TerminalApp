// ── Blackjack Game Engine — pure logic, no socket coupling ──

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
  hidden?: boolean;
}

export type TablePhase = 'waiting' | 'betting' | 'dealing' | 'player_turns' | 'dealer' | 'payout';

export interface PlayerState {
  userId: number;
  username: string;
  hand: Card[];
  bet: number;
  status: 'waiting' | 'betting' | 'playing' | 'standing' | 'busted' | 'blackjack' | 'done';
  result?: 'win' | 'lose' | 'push' | 'blackjack';
  payout: number;
}

export interface TableState {
  id: string;
  phase: TablePhase;
  players: PlayerState[];
  dealer: Card[];
  deck: Card[];
  currentPlayerIdx: number;
  timer: number; // seconds remaining
  minBet: number;
  maxBet: number;
}

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  // Double deck for multiplayer
  return [...deck, ...deck];
}

export function shuffleDeck(deck: Card[]): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
}

export function cardValue(card: Card): number {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

export function handValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.hidden) continue;
    total += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand) === 21;
}

export function isBusted(hand: Card[]): boolean {
  return handValue(hand) > 21;
}

export function cardStr(card: Card): string {
  if (card.hidden) return '[??]';
  return `[${card.rank}${card.suit}]`;
}

export function createTable(id: string): TableState {
  const deck = createDeck();
  shuffleDeck(deck);
  return {
    id,
    phase: 'waiting',
    players: [],
    dealer: [],
    deck,
    currentPlayerIdx: 0,
    timer: 0,
    minBet: 5,
    maxBet: 500,
  };
}

export function addPlayer(table: TableState, userId: number, username: string): boolean {
  if (table.players.length >= 4) return false;
  if (table.players.some(p => p.userId === userId)) return false;
  if (table.phase !== 'waiting' && table.phase !== 'betting') return false;
  table.players.push({
    userId, username, hand: [], bet: 0,
    status: table.phase === 'betting' ? 'betting' : 'waiting',
    payout: 0,
  });
  return true;
}

export function removePlayer(table: TableState, userId: number): boolean {
  const idx = table.players.findIndex(p => p.userId === userId);
  if (idx === -1) return false;
  table.players.splice(idx, 1);
  // Adjust currentPlayerIdx if needed
  if (table.currentPlayerIdx >= table.players.length) {
    table.currentPlayerIdx = Math.max(0, table.players.length - 1);
  }
  return true;
}

export function placeBet(table: TableState, userId: number, amount: number): string | null {
  if (table.phase !== 'betting') return 'not in betting phase';
  if (amount < table.minBet) return `minimum bet is ${table.minBet} NB`;
  if (amount > table.maxBet) return `maximum bet is ${table.maxBet} NB`;

  const player = table.players.find(p => p.userId === userId);
  if (!player) return 'not at this table';
  if (player.status !== 'betting' && player.status !== 'waiting') return 'already bet';

  player.bet = amount;
  player.status = 'betting'; // marks as "has bet"
  return null;
}

function drawCard(table: TableState, hidden = false): Card {
  if (table.deck.length === 0) {
    table.deck = createDeck();
    shuffleDeck(table.deck);
  }
  const card = table.deck.pop()!;
  if (hidden) card.hidden = true;
  return card;
}

export function startBetting(table: TableState): void {
  table.phase = 'betting';
  table.timer = 15;
  for (const p of table.players) {
    p.status = 'betting';
    p.hand = [];
    p.bet = 0;
    p.payout = 0;
    p.result = undefined;
  }
  table.dealer = [];
}

export function deal(table: TableState): void {
  table.phase = 'dealing';
  // Only deal to players who placed a bet
  const activePlayers = table.players.filter(p => p.bet > 0);
  if (activePlayers.length === 0) {
    table.phase = 'waiting';
    return;
  }

  // Reshuffle if low
  if (table.deck.length < 20) {
    table.deck = createDeck();
    shuffleDeck(table.deck);
  }

  // Deal 2 cards to each player and dealer
  for (let round = 0; round < 2; round++) {
    for (const p of activePlayers) {
      p.hand.push(drawCard(table));
    }
    table.dealer.push(drawCard(table, round === 1)); // second card hidden
  }

  // Check for blackjacks
  for (const p of activePlayers) {
    if (isBlackjack(p.hand)) {
      p.status = 'blackjack';
    } else {
      p.status = 'playing';
    }
  }

  // Move to player turns
  table.phase = 'player_turns';
  table.currentPlayerIdx = 0;
  advanceToNextPlayer(table);
}

function advanceToNextPlayer(table: TableState): void {
  while (table.currentPlayerIdx < table.players.length) {
    const p = table.players[table.currentPlayerIdx]!;
    if (p.status === 'playing') {
      table.timer = 30;
      return;
    }
    table.currentPlayerIdx++;
  }
  // All players done — dealer's turn
  dealerPlay(table);
}

export function hit(table: TableState, userId: number): string | null {
  if (table.phase !== 'player_turns') return 'not your turn phase';
  const p = table.players[table.currentPlayerIdx];
  if (!p || p.userId !== userId) return 'not your turn';
  if (p.status !== 'playing') return 'cannot hit';

  p.hand.push(drawCard(table));
  if (isBusted(p.hand)) {
    p.status = 'busted';
    table.currentPlayerIdx++;
    advanceToNextPlayer(table);
  }
  return null;
}

export function stand(table: TableState, userId: number): string | null {
  if (table.phase !== 'player_turns') return 'not your turn phase';
  const p = table.players[table.currentPlayerIdx];
  if (!p || p.userId !== userId) return 'not your turn';
  if (p.status !== 'playing') return 'cannot stand';

  p.status = 'standing';
  table.currentPlayerIdx++;
  advanceToNextPlayer(table);
  return null;
}

export function doubleDown(table: TableState, userId: number): string | null {
  if (table.phase !== 'player_turns') return 'not your turn phase';
  const p = table.players[table.currentPlayerIdx];
  if (!p || p.userId !== userId) return 'not your turn';
  if (p.status !== 'playing') return 'cannot double';
  if (p.hand.length !== 2) return 'can only double on first two cards';

  p.bet *= 2;
  p.hand.push(drawCard(table));
  if (isBusted(p.hand)) {
    p.status = 'busted';
  } else {
    p.status = 'standing';
  }
  table.currentPlayerIdx++;
  advanceToNextPlayer(table);
  return null;
}

function dealerPlay(table: TableState): void {
  table.phase = 'dealer';

  // Reveal hidden card
  for (const card of table.dealer) {
    card.hidden = false;
  }

  // Check if any active players (not busted, had a bet)
  const activeNonBusted = table.players.filter(
    p => p.bet > 0 && p.status !== 'busted'
  );

  if (activeNonBusted.length > 0) {
    // Dealer draws to 17
    while (handValue(table.dealer) < 17) {
      table.dealer.push(drawCard(table));
    }
  }

  resolveBets(table);
}

function resolveBets(table: TableState): void {
  table.phase = 'payout';
  const dealerVal = handValue(table.dealer);
  const dealerBusted = dealerVal > 21;
  const dealerBJ = isBlackjack(table.dealer);

  for (const p of table.players) {
    if (p.bet === 0) {
      p.status = 'done';
      continue;
    }

    const playerVal = handValue(p.hand);

    if (p.status === 'busted') {
      p.result = 'lose';
      p.payout = 0;
    } else if (p.status === 'blackjack') {
      if (dealerBJ) {
        p.result = 'push';
        p.payout = p.bet; // return bet
      } else {
        p.result = 'blackjack';
        p.payout = Math.floor(p.bet * 2.5); // 3:2 payout
      }
    } else if (dealerBusted) {
      p.result = 'win';
      p.payout = p.bet * 2;
    } else if (playerVal > dealerVal) {
      p.result = 'win';
      p.payout = p.bet * 2;
    } else if (playerVal === dealerVal) {
      p.result = 'push';
      p.payout = p.bet;
    } else {
      p.result = 'lose';
      p.payout = 0;
    }

    p.status = 'done';
  }
}

export function getPublicState(table: TableState): object {
  return {
    id: table.id,
    phase: table.phase,
    dealer: table.dealer.map(c => ({
      rank: c.hidden ? '?' : c.rank,
      suit: c.hidden ? '?' : c.suit,
      hidden: !!c.hidden,
      str: cardStr(c),
    })),
    dealerValue: handValue(table.dealer),
    players: table.players.map(p => ({
      userId: p.userId,
      username: p.username,
      hand: p.hand.map(c => ({
        rank: c.rank, suit: c.suit, str: cardStr(c),
      })),
      handValue: handValue(p.hand),
      bet: p.bet,
      status: p.status,
      result: p.result,
      payout: p.payout,
    })),
    currentPlayerIdx: table.currentPlayerIdx,
    timer: table.timer,
    minBet: table.minBet,
    maxBet: table.maxBet,
  };
}

// Easter eggs
export function getResultMessage(result: string | undefined, payout: number): string {
  if (!result) return '';
  if (result === 'blackjack') return payout === 69 ? 'BLACKJACK! nice. 😏' : `BLACKJACK! +${payout} NB 🃏`;
  if (result === 'win') return payout === 420 ? `+${payout} NB blaze it 🔥` : `you win! +${payout} NB`;
  if (result === 'push') return 'push. your NB lives another day.';
  if (result === 'lose') return 'busted. F in the chat.';
  return '';
}
