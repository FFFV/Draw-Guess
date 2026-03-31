const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { validateJoinRoom, validateDraw, validateChatMessage, validateLockRoom, validateKickPlayer, validateSimpleEvent, sanitizeInput } = require('./middleware/validation');
const { setupRateLimit } = require('./middleware/rateLimit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// 设置速率限制
setupRateLimit(io);
// 游戏配置
const WORDS = require('./words.json');
const GAME_STATE = {
  WAITING: 'waiting',
  WORD_SELECT: 'word_select',   // 新增：画家选题阶段
  DRAWING: 'drawing',
  GUESSING: 'guessing',
  FINISHED: 'finished'
};

const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  ROUND_TIME: 90,
  DRAWER_SCORE: 3,
  GUESSER_SCORES: [10, 8, 6, 4, 2],
  MAX_HISTORY: 30,
  WORD_SELECT_TIMEOUT: 30       // 选题超时（秒）
};

// 游戏房间数据
const rooms = new Map();

function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function createRoom(roomId, password = null) {
  const room = {
    id: roomId,
    password: password,
    players: [],
    ownerId: null,
    isLocked: false,
    drawerIndex: 0,
    word: getRandomWord(),
    state: GAME_STATE.WAITING,
    chatHistory: [],
    drawingData: { lines: [], clearCount: 0 },
    roundTimer: null,
    roundStartTime: null,
    timeLeft: GAME_CONFIG.ROUND_TIME,
    currentRound: 0,
    maxRounds: 0,
    guessedPlayers: [],
    isGameFinished: false,
    drawerHistory: [],
    historyStates: [],
    historyIndex: -1,
    lastActivity: Date.now(),
    // 选题相关
    selectionTimer: null,
    wordSelectionTimeout: GAME_CONFIG.WORD_SELECT_TIMEOUT
  };
  rooms.set(roomId, room);
  saveHistoryState(room);
  return room;
}

function getOrCreateRoom(roomId, password) {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId, password || null);
  } else {
    if (room.password && room.password !== password) {
      return { error: '密码错误' };
    }
  }
  return { room };
}

// 保存当前绘画状态到历史
function saveHistoryState(room) {
  const snapshot = JSON.parse(JSON.stringify(room.drawingData));
  if (room.historyIndex < room.historyStates.length - 1) {
    room.historyStates = room.historyStates.slice(0, room.historyIndex + 1);
  }
  room.historyStates.push(snapshot);
  if (room.historyStates.length > GAME_CONFIG.MAX_HISTORY) {
    room.historyStates.shift();
  } else {
    room.historyIndex = room.historyStates.length - 1;
  }
}

function undoDrawing(room) {
  if (room.historyIndex > 0) {
    room.historyIndex--;
    room.drawingData = JSON.parse(JSON.stringify(room.historyStates[room.historyIndex]));
    return true;
  }
  return false;
}

function redoDrawing(room) {
  if (room.historyIndex < room.historyStates.length - 1) {
    room.historyIndex++;
    room.drawingData = JSON.parse(JSON.stringify(room.historyStates[room.historyIndex]));
    return true;
  }
  return false;
}

// 广播全量画布数据
function broadcastCanvasFull(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('canvasUpdate', {
    drawingData: room.drawingData,
    canUndo: room.historyIndex > 0,
    canRedo: room.historyIndex < room.historyStates.length - 1
  });
}

// 广播房间状态（玩家列表、房主、锁定状态等）
function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('roomStateUpdate', {
    players: room.players,
    ownerId: room.ownerId,
    isLocked: room.isLocked
  });
}

// 统一的玩家离开处理
function handlePlayerLeave(room, playerId, isKick = false) {
  const playerIndex = room.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return null;
  
  const player = room.players[playerIndex];
  const wasDrawer = (player.role === 'drawer');
  const hadBeenDrawer = room.drawerHistory.includes(player.id);
  
  // 移除玩家
  room.players.splice(playerIndex, 1);
  
  // 处理房主转移
  if (player.id === room.ownerId && room.players.length > 0) {
    room.ownerId = room.players[0].id;
  }
  
  // 如果没有玩家了，删除房间
  if (room.players.length === 0) {
    if (room.roundTimer) clearInterval(room.roundTimer);
    if (room.selectionTimer) clearTimeout(room.selectionTimer);
    rooms.delete(room.id);
    return player;
  }

  // 只剩一人且游戏进行中，结束游戏
  if (room.players.length === 1 && room.state !== GAME_STATE.WAITING) {
      endGame(room.id);
      return player;
  }
  // 等待阶段直接更新列表
  if (room.state === GAME_STATE.WAITING) {
    broadcastRoomState(room.id);
    checkAllReady(room.id);
    return player;
  }
  
  // 游戏进行中的处理
  if (!hadBeenDrawer && room.currentRound <= room.maxRounds) {
    room.maxRounds--;
  }
  
  // 处理画家离开时的特殊逻辑
  if (wasDrawer) {
    // 如果处于选题阶段，需要重新选题给新画家
    if (room.state === GAME_STATE.WORD_SELECT) {
      // 清除旧定时器
      if (room.selectionTimer) {
        clearTimeout(room.selectionTimer);
        room.selectionTimer = null;
      }
      // 重新分配画家（可能需要重新计算索引）
      if (room.players.length > 0) {
        // 重新确定画家索引（避免索引越界）
        if (room.drawerIndex >= room.players.length) room.drawerIndex = 0;
        room.players.forEach((p, idx) => {
          p.role = idx === room.drawerIndex ? 'drawer' : 'guesser';
        });
        // 重新启动选题流程
        startWordSelection(room.id);
      }
    } else {
      // 正常画画阶段画家离开，结束当前回合
      if (room.roundTimer) clearInterval(room.roundTimer);
      room.state = GAME_STATE.FINISHED;
      io.to(room.id).emit('roundEnded', {
        word: room.word,
        guessedPlayers: room.guessedPlayers,
        drawer: player,
        players: room.players,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
      });
      if (room.currentRound >= room.maxRounds) {
        endGame(room.id);
      } else {
        setTimeout(() => {
          startNewRound(room.id);
        }, 3000);
      }
    }
  } else {
    // 猜词者离开，调整画师索引
    if (playerIndex < room.drawerIndex) {
      room.drawerIndex--;
    }
    // 重新分配角色
    room.players.forEach((p, idx) => {
      p.role = idx === room.drawerIndex ? 'drawer' : 'guesser';
    });
    broadcastRoomState(room.id);
    io.to(room.id).emit('roleUpdate', { players: room.players });
  }
  
  return player;
}

function getNextDrawerIndex(room) {
  if (room.drawerHistory.length === 0) {
    return Math.floor(Math.random() * room.players.length);
  }
  const startIndex = (room.drawerIndex + 1) % room.players.length;
  for (let i = 0; i < room.players.length; i++) {
    const index = (startIndex + i) % room.players.length;
    const player = room.players[index];
    if (!room.drawerHistory.includes(player.id)) {
      return index;
    }
  }
  return 0;
}

function checkAllReady(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.state !== GAME_STATE.WAITING) return;
  if (room.players.length < GAME_CONFIG.MIN_PLAYERS) return;
  const allReady = room.players.every(p => p.isReady);
  if (allReady) {
    startGameLogic(roomId);
  }
}

// 新增：开始选题流程
function startWordSelection(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.length === 0) return;
  if (room.state !== GAME_STATE.WAITING && room.state !== GAME_STATE.FINISHED && room.state !== GAME_STATE.WORD_SELECT) {
    // 如果已经在绘画中，不能选题
    return;
  }

  // 清除之前的选题定时器
  if (room.selectionTimer) {
    clearTimeout(room.selectionTimer);
    room.selectionTimer = null;
  }

  // 确定画家
  const drawerPlayer = room.players[room.drawerIndex];
  if (!drawerPlayer) {
    // 异常情况：重新分配画家
    room.drawerIndex = 0;
    room.players.forEach((p, idx) => {
      p.role = idx === room.drawerIndex ? 'drawer' : 'guesser';
    });
  }

  room.state = GAME_STATE.WORD_SELECT;
  
  // 通知所有非画家玩家：画家正在选题
  room.players.forEach(player => {
    if (player.id !== drawerPlayer.id) {
      io.to(player.id).emit('waitingForWord', {
        message: '画家正在选题，请稍候...',
        timeout: GAME_CONFIG.WORD_SELECT_TIMEOUT
      });
    }
  });

  io.to(roomId).emit('roleUpdate', { players: room.players });
  // 向画家发送选题请求
  io.to(drawerPlayer.id).emit('wordSelectionRequired', {
    timeout: GAME_CONFIG.WORD_SELECT_TIMEOUT,
    canCustom: true
  });

  // 设置超时自动选词
  room.selectionTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    if (currentRoom && currentRoom.state === GAME_STATE.WORD_SELECT) {
      // 超时自动使用随机词
      const randomWord = getRandomWord();
      currentRoom.word = randomWord;
      // 清理定时器并开始绘画阶段
      if (currentRoom.selectionTimer) {
        clearTimeout(currentRoom.selectionTimer);
        currentRoom.selectionTimer = null;
      }
      startDrawingPhase(roomId);
    }
  }, GAME_CONFIG.WORD_SELECT_TIMEOUT * 1000);
}

// 新增：开始绘画阶段（在选题完成后调用）
function startDrawingPhase(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.state !== GAME_STATE.WORD_SELECT) return;

  // 清除选题定时器
  if (room.selectionTimer) {
    clearTimeout(room.selectionTimer);
    room.selectionTimer = null;
  }

  // 重置绘画数据
  room.drawingData = { lines: [], clearCount: 0 };
  room.historyStates = [];
  room.historyIndex = -1;
  saveHistoryState(room);
  
  room.guessedPlayers = [];
  room.state = GAME_STATE.DRAWING;
  room.roundStartTime = Date.now();
  room.timeLeft = GAME_CONFIG.ROUND_TIME;
  
  // 启动回合计时器
  if (room.roundTimer) clearInterval(room.roundTimer);
  room.roundTimer = setInterval(() => {
    updateRoundTimer(roomId);
  }, 1000);

  // 广播开始绘画（新游戏或新回合）
  if (room.currentRound === 1 && room.maxRounds > 0) {
    // 游戏刚开始
    io.to(roomId).emit('gameStarted', {
      drawer: room.players[room.drawerIndex],
      word: room.word,
      state: room.state,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      timeLeft: room.timeLeft,
      players: room.players,
      ownerId: room.ownerId,
      isLocked: room.isLocked
    });
  } else {
    // 新回合
    io.to(roomId).emit('newRound', {
      drawer: room.players[room.drawerIndex],
      word: room.word,
      drawingData: room.drawingData,
      state: room.state,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      timeLeft: room.timeLeft,
      players: room.players,
      ownerId: room.ownerId,
      isLocked: room.isLocked
    });
  }
  
  broadcastCanvasFull(roomId);
  console.log(`房间 ${roomId} 绘画阶段开始，画师: ${room.players[room.drawerIndex].username}，词语: ${room.word}`);
}

// 修改：开始游戏逻辑（只分配角色和初始化回合数，然后启动选题）
function startGameLogic(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.length < GAME_CONFIG.MIN_PLAYERS) return;
  if (room.players.length > GAME_CONFIG.MAX_PLAYERS) return;
  if (room.state !== GAME_STATE.WAITING) return;

  // 随机分配第一个画家
  room.drawerIndex = Math.floor(Math.random() * room.players.length);
  room.players.forEach((player, index) => {
    player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
  });
  
  room.maxRounds = room.players.length;
  room.drawerHistory = [room.players[room.drawerIndex].id];
  room.currentRound = 1;
  room.state = GAME_STATE.WORD_SELECT; // 先进入选题状态
  room.word = ''; // 临时清空，等待画家选择
  
  // 启动选题流程
  startWordSelection(roomId);
}

// 修改：开始新回合（先分配新画家，然后启动选题）
function startNewRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // 确定下一个画家
  const nextDrawerIndex = getNextDrawerIndex(room);
  room.drawerIndex = nextDrawerIndex;
  
  room.players.forEach((player, index) => {
    player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
  });

  room.drawerHistory.push(room.players[room.drawerIndex].id);
  
  // 重置回合数据
  room.word = '';
  room.guessedPlayers = [];
  room.state = GAME_STATE.WORD_SELECT;
  
  // 启动选题流程
  startWordSelection(roomId);
}

function updateRoundTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== GAME_STATE.DRAWING || !room.roundStartTime) return;

  const elapsedSeconds = Math.floor((Date.now() - room.roundStartTime) / 1000);
  room.timeLeft = Math.max(0, GAME_CONFIG.ROUND_TIME - elapsedSeconds);

  io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft });

  if (room.timeLeft <= 0) {
    endRound(roomId);
  }
}

function endRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.roundTimer) {
    clearInterval(room.roundTimer);
    room.roundTimer = null;
  }
  if (room.selectionTimer) {
    clearTimeout(room.selectionTimer);
    room.selectionTimer = null;
  }

  room.state = GAME_STATE.FINISHED;
  
  io.to(roomId).emit('roundEnded', {
    word: room.word,
    guessedPlayers: room.guessedPlayers,
    drawer: room.players[room.drawerIndex],
    players: room.players,
    currentRound: room.currentRound,
    maxRounds: room.maxRounds
  });

  room.currentRound++;
  
  if (room.currentRound > room.maxRounds) {
    endGame(roomId);
    return;
  }

  setTimeout(() => {
    startNewRound(roomId);
  }, 3000);
}

function endGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.state = GAME_STATE.FINISHED;
  room.isGameFinished = true;

  let maxScore = -1;
  let winners = [];
  
  room.players.forEach(player => {
    if (player.score > maxScore) {
      maxScore = player.score;
      winners = [player];
    } else if (player.score === maxScore) {
      winners.push(player);
    }
  });

  io.to(roomId).emit('gameEnded', {
    players: room.players,
    winners: winners,
    finalScores: room.players.map(p => ({ username: p.username, score: p.score })),
    totalRounds: room.maxRounds,
    ownerId: room.ownerId,
    isLocked: room.isLocked
  });

  setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    if (currentRoom) {
      resetRoomData(roomId);
    }
  }, 1000);
}

function resetRoomData(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.roundTimer) {
    clearInterval(room.roundTimer);
    room.roundTimer = null;
  }
  if (room.selectionTimer) {
    clearTimeout(room.selectionTimer);
    room.selectionTimer = null;
  }

  room.state = GAME_STATE.WAITING;
  room.word = getRandomWord();
  room.drawingData = { lines: [], clearCount: 0 };
  room.currentRound = 0;
  room.maxRounds = 0;
  room.guessedPlayers = [];
  room.drawerHistory = [];
  room.drawerIndex = 0;
  room.roundStartTime = null;
  room.timeLeft = GAME_CONFIG.ROUND_TIME;
  room.isGameFinished = false;
  
  room.historyStates = [];
  room.historyIndex = -1;
  saveHistoryState(room);

  room.players.forEach(player => {
    player.score = 0;
    player.isReady = false;
    player.role = 'guesser';
  });
  
  const resetMsg = {
    id: Date.now(),
    username: '系统',
    message: '游戏已重置，所有玩家分数清零，请重新准备',
    timestamp: new Date().toLocaleTimeString(),
    isSystem: true
  };
  room.chatHistory.push(resetMsg);

  io.to(roomId).emit('gameReset', {
    roomId: room.id,
    players: room.players,
    ownerId: room.ownerId,
    isLocked: room.isLocked,
    currentRound: room.currentRound,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
    state: room.state,
    chatHistory: room.chatHistory,
    drawingData: room.drawingData,
    config: GAME_CONFIG
  });
  
  broadcastCanvasFull(roomId);
}

// 清理闲置房间
function cleanupInactiveRooms() {
  const now = Date.now();
  const inactiveTimeout = 30 * 60 * 1000;
  
  rooms.forEach((room, roomId) => {
    if (room.players.length > 0) {
      room.lastActivity = now;
      return;
    }
    if (now - room.lastActivity > inactiveTimeout) {
      console.log(`清理闲置房间: ${roomId}`);
      if (room.roundTimer) clearInterval(room.roundTimer);
      if (room.selectionTimer) clearTimeout(room.selectionTimer);
      rooms.delete(roomId);
    }
  });
}

setInterval(cleanupInactiveRooms, 5 * 60 * 1000);

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  socket.on('getRandomWord', () => {
    const word = getRandomWord();
    socket.emit('randomWord', { word });
  });
  
  socket.on('drawStart', (data) => {
    const { roomId, x, y, color, lineWidth } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    
    room.drawingData.lines.push({
      points: [{ x, y }],
      color,
      lineWidth
    });
    
    socket.to(roomId).emit('drawStart', { x, y, color, lineWidth });
  });

  socket.on('joinRoom', (roomId, username, password) => {
    const validation = validateJoinRoom({ roomId, username, password });
    if (!validation.valid) {
      socket.emit('joinError', { message: validation.message || '输入验证失败' });
      return;
    }
    
    const sanitizedRoomId = sanitizeInput(roomId);
    const sanitizedUsername = sanitizeInput(username);
    const sanitizedPassword = password ? sanitizeInput(password) : '';
    
    const { error, room } = getOrCreateRoom(sanitizedRoomId, sanitizedPassword);
    if (error) {
      socket.emit('joinError', { message: error });
      return;
    }

    if (room.players.some(p => p.username === sanitizedUsername)) {
        socket.emit('joinError', { message: '该用户名已在房间内，请更换用户名' });
        return;
    }

    if (room.state !== GAME_STATE.WAITING && room.state !== GAME_STATE.WORD_SELECT) {
        socket.emit('joinError', { message: '游戏已经开始，无法加入房间' });
        return;
    }

    if (room.isLocked && room.players.length > 0) {
      socket.emit('joinError', { message: '房间已锁定，无法加入' });
      return;
    }
    
    if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
      socket.emit('roomFull', { maxPlayers: GAME_CONFIG.MAX_PLAYERS });
      return;
    }
    
    const player = {
      id: socket.id,
      username: sanitizedUsername || `玩家${room.players.length + 1}`,
      role: 'guesser',
      score: 0,
      isReady: false
    };
    
    room.players.push(player);
    
    if (!room.ownerId) {
      room.ownerId = socket.id;
    }
    
    socket.join(roomId);
    
    socket.emit('roomInfo', {
      roomId,
      players: room.players,
      ownerId: room.ownerId,
      isLocked: room.isLocked,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      timeLeft: room.timeLeft,
      state: room.state,
      chatHistory: room.chatHistory,
      drawingData: room.drawingData,
      config: GAME_CONFIG
    });

    socket.to(roomId).emit('playerJoined', {
      player,
      players: room.players,
      ownerId: room.ownerId,
      isLocked: room.isLocked
    });

    // 如果房间正处于选题阶段且加入的玩家是当前画家，则重新发送选题请求（避免画家重连后无弹窗）
    if (room.state === GAME_STATE.WORD_SELECT && room.players[room.drawerIndex] && room.players[room.drawerIndex].id === socket.id) {
      // 清理旧定时器
      if (room.selectionTimer) {
        clearTimeout(room.selectionTimer);
        room.selectionTimer = null;
      }
      // 重新发送选题请求
      io.to(socket.id).emit('wordSelectionRequired', {
        timeout: GAME_CONFIG.WORD_SELECT_TIMEOUT,
        canCustom: true
      });
      // 重置超时定时器
      room.selectionTimer = setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.state === GAME_STATE.WORD_SELECT) {
          const randomWord = getRandomWord();
          currentRoom.word = randomWord;
          if (currentRoom.selectionTimer) clearTimeout(currentRoom.selectionTimer);
          startDrawingPhase(roomId);
        }
      }, GAME_CONFIG.WORD_SELECT_TIMEOUT * 1000);
    }

    console.log(`${player.username} 加入了房间 ${roomId}`);
  });

  socket.on('toggleReady', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (room.state !== GAME_STATE.WAITING) {
      socket.emit('gameError', { message: '游戏已开始，无法改变准备状态' });
      return;
    }
    player.isReady = !player.isReady;
    broadcastRoomState(roomId);
    checkAllReady(roomId);
  });

  socket.on('lockRoom', ({ roomId, lock }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.ownerId !== socket.id) {
      socket.emit('gameError', { message: '只有房主可以锁定房间' });
      return;
    }
    room.isLocked = lock;
    io.to(roomId).emit('roomLocked', { isLocked: room.isLocked });
    broadcastRoomState(roomId);
  });

  socket.on('kickPlayer', ({ roomId, targetPlayerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.ownerId !== socket.id) {
      socket.emit('gameError', { message: '只有房主可以踢出玩家' });
      return;
    }
    if (targetPlayerId === socket.id) {
      socket.emit('gameError', { message: '不能踢出自己' });
      return;
    }
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) return;
    
    const targetSocket = io.sockets.sockets.get(targetPlayerId);
    if (targetSocket) {
      targetSocket.emit('kicked', { message: `你被房主 ${room.players.find(p => p.id === room.ownerId)?.username} 踢出了房间` });
      targetSocket.disconnect(true);
    }
    
    handlePlayerLeave(room, targetPlayerId, true);
    broadcastRoomState(roomId);
  });

  socket.on('drawBatch', (data) => {
    const { roomId, points, color, lineWidth } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;

    let currentLine = room.drawingData.lines[room.drawingData.lines.length - 1];
    if (!currentLine) {
      currentLine = { points: [], color, lineWidth };
      room.drawingData.lines.push(currentLine);
    } else if (currentLine.color !== color || currentLine.lineWidth !== lineWidth) {
      currentLine = { points: [], color, lineWidth };
      room.drawingData.lines.push(currentLine);
    }
    currentLine.points.push(...points);

    socket.to(roomId).emit('drawBatch', { points, color, lineWidth });
  });

  socket.on('draw', (data) => {
    const { roomId, x, y, type, color, lineWidth } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    
    if (type === 'start') {
      room.drawingData.lines.push({ 
        points: [{ x, y }], 
        color: color || '#000000',
        lineWidth: lineWidth || 3
      });
    } else if (type === 'move') {
      const currentLine = room.drawingData.lines[room.drawingData.lines.length - 1];
      if (currentLine) {
        currentLine.points.push({ x, y });
      }
    }
  });

  socket.on('drawEnd', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;

    saveHistoryState(room);
    broadcastCanvasFull(roomId);
  });
  
  socket.on('drawClear', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    saveHistoryState(room);
    room.drawingData = { lines: [], clearCount: room.drawingData.clearCount + 1 };
    saveHistoryState(room);
    broadcastCanvasFull(roomId);
  });
  
  socket.on('undo', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    if (undoDrawing(room)) {
      broadcastCanvasFull(roomId);
    }
  });
  
  socket.on('redo', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    if (redoDrawing(room)) {
      broadcastCanvasFull(roomId);
    }
  });

  // 新增：画家提交选题
  socket.on('submitWord', (data) => {
    const { roomId, word } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.state !== GAME_STATE.WORD_SELECT) {
      socket.emit('wordSubmitError', { message: '当前不在选题阶段' });
      return;
    }
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) {
      socket.emit('wordSubmitError', { message: '只有当前画家可以选择题目' });
      return;
    }

    let finalWord = '';
    if (word === null || word === '') {
      // 选择随机
      finalWord = getRandomWord();
    } else {
      // 自定义词验证
      let trimmed = sanitizeInput(word).trim();
      if (trimmed.length === 0) {
        socket.emit('wordSubmitError', { message: '题目不能为空' });
        return;
      }
      if (trimmed.length > 20) {
        socket.emit('wordSubmitError', { message: '题目长度不能超过20个字符' });
        return;
      }
      // 简单限制：只允许中英文、数字、空格及常用标点
      if (!/^[\u4e00-\u9fa5a-zA-Z0-9\s\.,;:!?\-_'"()]+$/.test(trimmed)) {
        socket.emit('wordSubmitError', { message: '题目包含非法字符，请使用中文、英文、数字或常用标点' });
        return;
      }
      finalWord = trimmed;
    }

    room.word = finalWord;
    // 清除选题定时器
    if (room.selectionTimer) {
      clearTimeout(room.selectionTimer);
      room.selectionTimer = null;
    }
    // 开始绘画阶段
    startDrawingPhase(roomId);
  });

  socket.on('chatMessage', (data) => {
    const validation = validateChatMessage(data);
    if (!validation.valid) {
      socket.emit('chatError', { message: validation.message || '消息验证失败' });
      return;
    }

    const { roomId, message, username } = data;
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;
    
    if (sender.role === 'drawer' && room.state === GAME_STATE.DRAWING) {
      socket.emit('chatError', { message: '画师在画画期间不能发送聊天消息' });
      return;
    }

    const sanitizedMessage = sanitizeInput(message);
    
    const isCorrectGuess = sanitizedMessage.includes(room.word) && room.state === GAME_STATE.DRAWING;
    
    if (isCorrectGuess) {
      handleCorrectGuess(room, socket.id, sanitizedMessage);
      
      const systemMsg = {
        id: Date.now(),
        username: '系统',
        message: `${username} 猜对了！`,
        timestamp: new Date().toLocaleTimeString(),
        isSystem: true,
        correctGuess: true
      };
      
      room.chatHistory.push(systemMsg);
      io.to(roomId).emit('chatMessage', systemMsg);
      
      if (room.guessedPlayers.length >= room.players.length - 1) {
        endRound(roomId);
      }
    } else {
      const chatMsg = {
        id: Date.now(),
        username,
        message: sanitizedMessage,
        timestamp: new Date().toLocaleTimeString(),
        isSystem: false
      };

      room.chatHistory.push(chatMsg);
      io.to(roomId).emit('chatMessage', chatMsg);
    }
  });
  
  socket.on('startGame', (roomId) => {
    startGameLogic(roomId);
  });

  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    rooms.forEach((room, roomId) => {
      const playerExists = room.players.some(p => p.id === socket.id);
      if (playerExists) {
        handlePlayerLeave(room, socket.id);
        broadcastRoomState(roomId);
      }
    });
  });
});

function handleCorrectGuess(room, playerId, guessMessage) {
  if (room.guessedPlayers.some(p => p.playerId === playerId)) {
    return;
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  const guesserIndex = room.guessedPlayers.length;
  const scoreIndex = Math.min(guesserIndex, GAME_CONFIG.GUESSER_SCORES.length - 1);
  const scoreToAdd = GAME_CONFIG.GUESSER_SCORES[scoreIndex];
  
  player.score += scoreToAdd;
  
  room.guessedPlayers.push({
    playerId,
    username: player.username,
    scoreAdded: scoreToAdd,
    guessMessage,
    timestamp: Date.now()
  });

  const drawer = room.players[room.drawerIndex];
  if (drawer && room.guessedPlayers.length === 1) {
    drawer.score += GAME_CONFIG.DRAWER_SCORE;
  }

  io.to(room.id).emit('scoreUpdate', {
    players: room.players,
    guessedPlayers: room.guessedPlayers
  });
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log('房间清理定时器已启动（每5分钟检查一次）');
});