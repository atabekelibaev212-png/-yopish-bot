// Oddiy shashka (checkers) o'yin dvigateli, 8x8 taxta, socket.io orqali real-time
const { nanoid } = require('nanoid');

function createBoard() {
  // 0 = bo'sh, 1 = 1-o'yinchi (oq), 2 = 2-o'yinchi (qora), 3/4 = king (shohlar)
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 2; // qora yuqorida
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 1; // oq pastda
    }
  }
  return board;
}

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isOwn(piece, player) { return piece === player || piece === player + 2; }
function isOpponent(piece, player) { const opp = player === 1 ? 2 : 1; return piece === opp || piece === opp + 2; }
function isKing(piece) { return piece === 3 || piece === 4; }

function getValidMoves(board, r, c, player) {
  const piece = board[r][c];
  if (!isOwn(piece, player)) return [];
  const king = isKing(piece);
  const dirs = king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : (player === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);

  const simpleMoves = [];
  const captureMoves = [];

  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc] === 0) {
      simpleMoves.push({ to: [nr, nc], captured: null });
    } else if (isOpponent(board[nr][nc], player)) {
      const jr = nr + dr, jc = nc + dc;
      if (inBounds(jr, jc) && board[jr][jc] === 0) {
        captureMoves.push({ to: [jr, jc], captured: [nr, nc] });
      }
    }
  }
  // Standart qoida: agar yeyish imkoni bo'lsa, faqat yeyish ruxsat etiladi
  return captureMoves.length > 0 ? captureMoves : simpleMoves;
}

function boardHasAnyCapture(board, player) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isOwn(board[r][c], player)) {
        const moves = getValidMoves(board, r, c, player);
        if (moves.some(m => m.captured)) return true;
      }
    }
  }
  return false;
}

function applyMove(game, from, to) {
  const board = game.board;
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = board[fr][fc];
  const player = game.turn;
  const moves = getValidMoves(board, fr, fc, player);
  const chosen = moves.find(m => m.to[0] === tr && m.to[1] === tc);
  if (!chosen) return { ok: false, error: 'Noto\'g\'ri yurish' };

  board[fr][fc] = 0;
  let newPiece = piece;
  // Shohlikka o'tish
  if (player === 1 && tr === 0) newPiece = 3;
  if (player === 2 && tr === 7) newPiece = 4;
  board[tr][tc] = newPiece;

  let extraTurn = false;
  if (chosen.captured) {
    board[chosen.captured[0]][chosen.captured[1]] = 0;
    // Zanjirli yeyish tekshiruvi
    const nextCaptures = getValidMoves(board, tr, tc, player).filter(m => m.captured);
    if (nextCaptures.length > 0) extraTurn = true;
  }

  // G'olibni tekshirish
  const oppPlayer = player === 1 ? 2 : 1;
  let oppHasPieces = false, oppHasMoves = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isOwn(board[r][c], oppPlayer)) {
        oppHasPieces = true;
        if (getValidMoves(board, r, c, oppPlayer).length > 0) oppHasMoves = true;
      }
    }
  }

  let winner = null;
  if (!oppHasPieces || !oppHasMoves) winner = player;

  if (!extraTurn) game.turn = oppPlayer;
  if (winner) game.winner = winner;

  return { ok: true, extraTurn, winner };
}

function initCheckers(io, db, adminIds) {
  const games = {}; // gameId -> { board, players:[id1,id2], turn, betDiamonds, socketIds:{} , winner }

  const nsp = io.of('/checkers');

  nsp.on('connection', (socket) => {
    socket.on('create_game', ({ userId }, cb) => {
      const gameId = nanoid(6).toUpperCase();
      games[gameId] = {
        id: gameId,
        board: createBoard(),
        players: [userId],
        turn: 1,
        socketIds: { [userId]: socket.id },
        winner: null,
        ready: {}
      };
      socket.join(gameId);
      socket.data.userId = userId;
      socket.data.gameId = gameId;
      cb && cb({ ok: true, gameId });
    });

    socket.on('join_game', ({ userId, gameId }, cb) => {
      const game = games[gameId];
      if (!game) return cb && cb({ ok: false, error: 'O\'yin topilmadi' });
      if (game.players.length >= 2 && !game.players.includes(userId)) {
        return cb && cb({ ok: false, error: 'O\'yin to\'la' });
      }
      if (!game.players.includes(userId)) game.players.push(userId);
      game.socketIds[userId] = socket.id;
      socket.join(gameId);
      socket.data.userId = userId;
      socket.data.gameId = gameId;
      cb && cb({ ok: true, game: publicGame(game) });
      nsp.to(gameId).emit('game_update', publicGame(game));
    });

    socket.on('ready', ({ gameId, userId }) => {
      const game = games[gameId];
      if (!game) return;
      game.ready[userId] = true;
      nsp.to(gameId).emit('game_update', publicGame(game));
    });

    socket.on('move', ({ gameId, userId, from, to }, cb) => {
      const game = games[gameId];
      if (!game) return cb && cb({ ok: false, error: 'O\'yin topilmadi' });
      const playerNum = game.players.indexOf(userId) + 1;
      if (playerNum !== game.turn) return cb && cb({ ok: false, error: 'Sizning navbatingiz emas' });
      const result = applyMove(game, from, to);
      if (!result.ok) return cb && cb(result);

      if (result.winner) {
        const winnerId = game.players[result.winner - 1];
        const loserId = game.players[result.winner === 1 ? 1 : 0];
        const wUser = db.getUser(winnerId);
        const lUser = loserId ? db.getUser(loserId) : null;
        wUser.stats.games += 1; wUser.stats.wins += 1;
        db.updateUser(wUser.id, wUser);
        if (lUser) {
          lUser.stats.games += 1; lUser.stats.losses += 1;
          db.updateUser(lUser.id, lUser);
        }
      }

      cb && cb({ ok: true });
      nsp.to(gameId).emit('game_update', publicGame(game));
    });

    socket.on('disconnect', () => {
      // Sokratcha: o'yin holatini saqlab qolamiz, foydalanuvchi qayta ulanishi mumkin
    });
  });

  function publicGame(game) {
    return {
      id: game.id,
      board: game.board,
      players: game.players,
      turn: game.turn,
      winner: game.winner,
      ready: game.ready
    };
  }
}

module.exports = { initCheckers, createBoard, getValidMoves };
