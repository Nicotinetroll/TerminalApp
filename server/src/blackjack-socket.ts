import type { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import db from './db.js';
import {
  createTable, addPlayer, removePlayer, placeBet, deal,
  hit, stand, doubleDown, startBetting, getPublicState,
  getResultMessage,
} from './blackjack.js';
import type { TableState } from './blackjack.js';

const tables = new Map<string, TableState>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

function ensureBalance(userId: number): void {
  db.prepare(`
    INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, updated_at)
    VALUES (?, 0, 0, 0, 0, 0, 0, datetime('now'))
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

function getNB(userId: number): number {
  ensureBalance(userId);
  const row = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number };
  return row.bytebucks;
}

function deductNB(userId: number, amount: number): boolean {
  ensureBalance(userId);
  const row = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number };
  if (row.bytebucks < amount) return false;
  db.prepare('UPDATE slots_balance SET bytebucks = bytebucks - ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(amount, userId);
  return true;
}

function addNB(userId: number, amount: number): void {
  ensureBalance(userId);
  db.prepare('UPDATE slots_balance SET bytebucks = bytebucks + ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(amount, userId);
}

function broadcastTableState(io: Server, table: TableState): void {
  io.to(`bj:${table.id}`).emit('blackjack:state', getPublicState(table));
}

function broadcastTableList(io: Server): void {
  const list = Array.from(tables.values()).map(t => ({
    id: t.id,
    phase: t.phase,
    playerCount: t.players.length,
    players: t.players.map(p => p.username),
  }));
  io.emit('blackjack:tables', list);
}

function startTimer(io: Server, table: TableState): void {
  clearTableTimer(table.id);
  const interval = setInterval(() => {
    table.timer--;
    io.to(`bj:${table.id}`).emit('blackjack:timer', table.timer);

    if (table.timer <= 0) {
      clearTableTimer(table.id);
      if (table.phase === 'betting') {
        // Auto-deal with whoever placed bets
        const hasBets = table.players.some(p => p.bet > 0);
        if (hasBets) {
          deal(table);
          broadcastTableState(io, table);
          const phase = table.phase as string;
          if (phase === 'player_turns') {
            startTimer(io, table);
          } else if (phase === 'payout') {
            handlePayout(io, table);
          }
        } else {
          // Nobody bet, go back to waiting
          table.phase = 'waiting';
          broadcastTableState(io, table);
        }
      } else if (table.phase === 'player_turns') {
        // Auto-stand for current player
        const p = table.players[table.currentPlayerIdx];
        if (p && p.status === 'playing') {
          stand(table, p.userId);
          broadcastTableState(io, table);
          if (table.phase === 'player_turns') {
            startTimer(io, table);
          } else if (table.phase === 'payout') {
            handlePayout(io, table);
          }
        }
      }
    }
  }, 1000);
  timers.set(table.id, interval);
}

function clearTableTimer(tableId: string): void {
  const t = timers.get(tableId);
  if (t) { clearInterval(t); timers.delete(tableId); }
}

function handlePayout(io: Server, table: TableState): void {
  for (const p of table.players) {
    if (p.payout > 0) {
      addNB(p.userId, p.payout);
    }
    const msg = getResultMessage(p.result, p.payout);
    if (msg) {
      io.to(`bj:${table.id}`).emit('blackjack:result', {
        userId: p.userId, username: p.username,
        result: p.result, payout: p.payout, bet: p.bet, message: msg,
        nb_balance: getNB(p.userId),
      });
    }
  }

  broadcastTableState(io, table);

  // After 5 seconds, start next round if players remain
  setTimeout(() => {
    if (table.players.length > 0) {
      startBetting(table);
      broadcastTableState(io, table);
      startTimer(io, table);
      broadcastTableList(io);
    } else {
      tables.delete(table.id);
      clearTableTimer(table.id);
      broadcastTableList(io);
    }
  }, 5000);
}

export function setupBlackjack(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthPayload | undefined;
    if (!user) return;

    // List tables
    socket.on('blackjack:tables', (callback: (tables: unknown[]) => void) => {
      const list = Array.from(tables.values()).map(t => ({
        id: t.id,
        phase: t.phase,
        playerCount: t.players.length,
        players: t.players.map(p => p.username),
      }));
      callback(list);
    });

    // Create table
    socket.on('blackjack:create', (callback: (r: { ok: boolean; tableId?: string; error?: string }) => void) => {
      const tableId = 'bj-' + crypto.randomBytes(4).toString('hex');
      const table = createTable(tableId);
      addPlayer(table, user.userId, user.username);
      tables.set(tableId, table);
      void socket.join(`bj:${tableId}`);
      broadcastTableList(io);
      callback({ ok: true, tableId });
    });

    // Join table
    socket.on('blackjack:join', (data: { tableId: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const table = tables.get(data.tableId);
      if (!table) { callback({ ok: false, error: 'table not found. poof.' }); return; }
      if (!addPlayer(table, user.userId, user.username)) {
        callback({ ok: false, error: 'table is full or game in progress.' }); return;
      }
      void socket.join(`bj:${table.id}`);
      broadcastTableState(io, table);
      broadcastTableList(io);

      // If we now have 2+ players and still waiting, start betting
      if (table.phase === 'waiting' && table.players.length >= 1) {
        startBetting(table);
        broadcastTableState(io, table);
        startTimer(io, table);
      }

      callback({ ok: true });
    });

    // Leave table
    socket.on('blackjack:leave', (data: { tableId: string }, callback: (r: { ok: boolean }) => void) => {
      const table = tables.get(data.tableId);
      if (table) {
        removePlayer(table, user.userId);
        void socket.leave(`bj:${table.id}`);
        if (table.players.length === 0) {
          tables.delete(table.id);
          clearTableTimer(table.id);
        } else {
          broadcastTableState(io, table);
        }
        broadcastTableList(io);
      }
      callback({ ok: true });
    });

    // Place bet
    socket.on('blackjack:bet', (data: { tableId: string; amount: number }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const table = tables.get(data.tableId);
      if (!table) { callback({ ok: false, error: 'table not found' }); return; }

      const amount = Math.floor(data.amount);
      const nb = getNB(user.userId);
      if (nb < amount) {
        callback({ ok: false, error: `you only have ${nb} NB. broke boy.` }); return;
      }

      const err = placeBet(table, user.userId, amount);
      if (err) { callback({ ok: false, error: err }); return; }

      // Deduct NB
      if (!deductNB(user.userId, amount)) {
        callback({ ok: false, error: 'insufficient NB' }); return;
      }

      broadcastTableState(io, table);

      // If all players have bet, deal immediately
      const allBet = table.players.every(p => p.bet > 0);
      if (allBet) {
        clearTableTimer(table.id);
        deal(table);
        broadcastTableState(io, table);
        if (table.phase === 'player_turns') {
          startTimer(io, table);
        } else if (table.phase === 'payout') {
          handlePayout(io, table);
        }
      }

      callback({ ok: true });
    });

    // Hit
    socket.on('blackjack:hit', (data: { tableId: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const table = tables.get(data.tableId);
      if (!table) { callback({ ok: false, error: 'table not found' }); return; }

      const err = hit(table, user.userId);
      if (err) { callback({ ok: false, error: err }); return; }

      broadcastTableState(io, table);
      if (table.phase === 'player_turns') {
        startTimer(io, table);
      } else if (table.phase === 'payout') {
        handlePayout(io, table);
      }
      callback({ ok: true });
    });

    // Stand
    socket.on('blackjack:stand', (data: { tableId: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const table = tables.get(data.tableId);
      if (!table) { callback({ ok: false, error: 'table not found' }); return; }

      const err = stand(table, user.userId);
      if (err) { callback({ ok: false, error: err }); return; }

      broadcastTableState(io, table);
      if (table.phase === 'player_turns') {
        startTimer(io, table);
      } else if (table.phase === 'payout') {
        handlePayout(io, table);
      }
      callback({ ok: true });
    });

    // Double down
    socket.on('blackjack:double', (data: { tableId: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const table = tables.get(data.tableId);
      if (!table) { callback({ ok: false, error: 'table not found' }); return; }

      const p = table.players.find(pl => pl.userId === user.userId);
      if (!p) { callback({ ok: false, error: 'not at this table' }); return; }

      // Need to deduct extra bet for double
      const extraBet = p.bet;
      if (!deductNB(user.userId, extraBet)) {
        callback({ ok: false, error: `need ${extraBet} more NB to double. broke boy.` }); return;
      }

      const err = doubleDown(table, user.userId);
      if (err) {
        // Refund the extra if double fails
        addNB(user.userId, extraBet);
        callback({ ok: false, error: err }); return;
      }

      broadcastTableState(io, table);
      if (table.phase === 'player_turns') {
        startTimer(io, table);
      } else if (table.phase === 'payout') {
        handlePayout(io, table);
      }
      callback({ ok: true });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      for (const [tableId, table] of tables) {
        if (removePlayer(table, user.userId)) {
          void socket.leave(`bj:${tableId}`);
          if (table.players.length === 0) {
            tables.delete(tableId);
            clearTableTimer(tableId);
          } else {
            broadcastTableState(io, table);
          }
          broadcastTableList(io);
        }
      }
    });
  });
}
