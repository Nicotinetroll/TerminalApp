import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import {
  createDeck, shuffleDeck, cardValue, handValue,
  isBlackjack, isBusted,
} from '../blackjack.js';
import type { Card, Rank, Suit } from '../blackjack.js';

const router = Router();

// ── In-memory game state ──

interface SoloGame {
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  bet: number;
  status: 'playing' | 'bust' | 'blackjack' | 'win' | 'lose' | 'push';
  payout: number;
  timestamp: number;
}

const games = new Map<number, SoloGame>();

// Auto-expire stale games every 60s
setInterval(() => {
  const now = Date.now();
  for (const [uid, g] of games) {
    if (now - g.timestamp > 5 * 60 * 1000) games.delete(uid);
  }
}, 60_000);

// ── Helpers ──

function makeDeck(): Card[] {
  const deck = createDeck(); // double deck
  shuffleDeck(deck);
  return deck;
}

function draw(game: SoloGame): Card {
  if (game.deck.length === 0) {
    game.deck = makeDeck();
  }
  return game.deck.pop()!;
}

function getNB(userId: number): number {
  const row = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number } | undefined;
  return row?.bytebucks ?? 0;
}

function setNB(userId: number, amount: number): void {
  db.prepare(`
    INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, bytebucks, updated_at)
    VALUES (?, 0, 0, 0, 0, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET bytebucks = ?, updated_at = datetime('now')
  `).run(userId, amount, amount);
}

function cardResponse(card: Card, hidden = false): { rank: Rank | '?'; suit: Suit | '?'; hidden: boolean } {
  if (hidden) return { rank: '?', suit: '?', hidden: true };
  return { rank: card.rank, suit: card.suit, hidden: false };
}

function gameResponse(game: SoloGame, nb: number, hideDealer = true) {
  const dealerCards = game.dealerHand.map((c, i) =>
    cardResponse(c, hideDealer && i === 1 && game.status === 'playing')
  );

  // Dealer value: only count visible cards when hiding
  const dealerVisible = hideDealer && game.status === 'playing'
    ? game.dealerHand.slice(0, 1)
    : game.dealerHand;

  return {
    playerHand: game.playerHand.map(c => cardResponse(c)),
    playerValue: handValue(game.playerHand),
    dealerHand: dealerCards,
    dealerValue: handValue(dealerVisible),
    bet: game.bet,
    status: game.status,
    payout: game.payout,
    nb_balance: nb,
    message: getResultMessage(game),
  };
}

function getResultMessage(game: SoloGame): string {
  switch (game.status) {
    case 'playing': return '';
    case 'blackjack': {
      if (game.payout === 69) return 'BLACKJACK! nice. 😏';
      return `BLACKJACK! +${game.payout} NB 🃏`;
    }
    case 'win': {
      if (game.payout === 420) return `+${game.payout} NB blaze it 🔥`;
      if (game.payout === 69) return `+${game.payout} NB nice.`;
      return `you win! +${game.payout} NB`;
    }
    case 'push': return 'push. your NB lives another day.';
    case 'bust': return 'busted. F in the chat.';
    case 'lose': {
      const msgs = [
        'dealer wins. cope.',
        'house always wins. (not really, but today it did)',
        'L.',
        'dealer said nah.',
        'better luck next hand.',
        'the house sends its regards.',
      ];
      return msgs[Math.floor(Math.random() * msgs.length)]!;
    }
    default: return '';
  }
}

function dealerPlay(game: SoloGame): void {
  // Dealer draws to 17
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(draw(game));
  }
}

function resolveGame(game: SoloGame): void {
  const playerVal = handValue(game.playerHand);
  const dealerVal = handValue(game.dealerHand);
  const dealerBusted = dealerVal > 21;

  if (dealerBusted) {
    game.status = 'win';
    game.payout = game.bet * 2;
  } else if (playerVal > dealerVal) {
    game.status = 'win';
    game.payout = game.bet * 2;
  } else if (playerVal === dealerVal) {
    game.status = 'push';
    game.payout = game.bet; // return bet
  } else {
    game.status = 'lose';
    game.payout = 0;
  }
}

// ── Routes ──

router.use(authMiddleware);

// GET /api/blackjack/state — current game state (if any)
router.get('/state', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const nb = getNB(userId);
  const game = games.get(userId);

  if (!game || game.status !== 'playing') {
    res.json({ active: false, nb_balance: nb });
    return;
  }

  res.json({ active: true, ...gameResponse(game, nb) });
});

// POST /api/blackjack/deal — start new game
router.post('/deal', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests don't get cards. log in first." });
    return;
  }

  // Check no active game
  const existing = games.get(userId);
  if (existing && existing.status === 'playing') {
    res.status(400).json({ error: 'finish your current hand first, degenerate.' });
    return;
  }

  const { bet } = req.body as { bet?: number };
  if (!bet || typeof bet !== 'number' || bet < 1 || bet > 20 || !Number.isInteger(bet)) {
    res.status(400).json({ error: 'bet must be 1-20 NB (whole numbers).' });
    return;
  }

  // Transaction: check balance + deduct bet
  const result = db.transaction(() => {
    const currentNB = getNB(userId);
    if (currentNB < bet) {
      return { error: "you're NB broke. go beg in the shop." } as const;
    }

    // Deduct bet upfront
    setNB(userId, currentNB - bet);

    // Create game
    const game: SoloGame = {
      deck: makeDeck(),
      playerHand: [],
      dealerHand: [],
      bet,
      status: 'playing',
      payout: 0,
      timestamp: Date.now(),
    };

    // Deal 2 cards each
    game.playerHand.push(draw(game));
    game.dealerHand.push(draw(game));
    game.playerHand.push(draw(game));
    game.dealerHand.push(draw(game));

    // Check for instant blackjack
    const playerBJ = isBlackjack(game.playerHand);
    const dealerBJ = isBlackjack(game.dealerHand);

    if (playerBJ || dealerBJ) {
      if (playerBJ && dealerBJ) {
        game.status = 'push';
        game.payout = bet; // return bet
      } else if (playerBJ) {
        game.status = 'blackjack';
        game.payout = Math.floor(bet * 2.5); // 3:2 payout
      } else {
        game.status = 'lose';
        game.payout = 0;
      }

      // Pay out
      const afterNB = getNB(userId);
      setNB(userId, afterNB + game.payout);
      games.set(userId, game);
      return { game, nb: afterNB + game.payout } as const;
    }

    games.set(userId, game);
    return { game, nb: currentNB - bet } as const;
  })();

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(gameResponse(result.game, result.nb, result.game.status === 'playing'));
});

// POST /api/blackjack/hit
router.post('/hit', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const game = games.get(userId);

  if (!game || game.status !== 'playing') {
    res.status(400).json({ error: "no active game. deal first." });
    return;
  }

  game.playerHand.push(draw(game));
  game.timestamp = Date.now();

  if (isBusted(game.playerHand)) {
    game.status = 'bust';
    game.payout = 0;
    // Bet already deducted, no payout
    const nb = getNB(userId);
    res.json(gameResponse(game, nb, false));
    return;
  }

  // Auto-21 stand
  if (handValue(game.playerHand) === 21) {
    dealerPlay(game);
    resolveGame(game);
    const nb = db.transaction(() => {
      const current = getNB(userId);
      setNB(userId, current + game.payout);
      return current + game.payout;
    })();
    res.json(gameResponse(game, nb, false));
    return;
  }

  const nb = getNB(userId);
  res.json(gameResponse(game, nb));
});

// POST /api/blackjack/stand
router.post('/stand', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const game = games.get(userId);

  if (!game || game.status !== 'playing') {
    res.status(400).json({ error: "no active game. deal first." });
    return;
  }

  dealerPlay(game);
  resolveGame(game);
  game.timestamp = Date.now();

  const nb = db.transaction(() => {
    const current = getNB(userId);
    setNB(userId, current + game.payout);
    return current + game.payout;
  })();

  res.json(gameResponse(game, nb, false));
});

// POST /api/blackjack/double
router.post('/double', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const game = games.get(userId);

  if (!game || game.status !== 'playing') {
    res.status(400).json({ error: "no active game. deal first." });
    return;
  }

  if (game.playerHand.length !== 2) {
    res.status(400).json({ error: "can only double on first two cards." });
    return;
  }

  // Deduct extra bet
  const doubleTx = db.transaction(() => {
    const currentNB = getNB(userId);
    if (currentNB < game.bet) {
      return { error: "can't afford to double. poverty move." } as const;
    }
    setNB(userId, currentNB - game.bet);
    game.bet *= 2;
    return { ok: true } as const;
  })();

  if ('error' in doubleTx) {
    res.status(400).json({ error: doubleTx.error });
    return;
  }

  // Draw exactly one card
  game.playerHand.push(draw(game));
  game.timestamp = Date.now();

  if (isBusted(game.playerHand)) {
    game.status = 'bust';
    game.payout = 0;
    const nb = getNB(userId);
    res.json(gameResponse(game, nb, false));
    return;
  }

  // Auto-stand after double
  dealerPlay(game);
  resolveGame(game);

  const nb = db.transaction(() => {
    const current = getNB(userId);
    setNB(userId, current + game.payout);
    return current + game.payout;
  })();

  res.json(gameResponse(game, nb, false));
});

export default router;
