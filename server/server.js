const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// 游戏配置
const WORDS = [
  '苹果', '小猫', '太阳', '汽车', '房子', '大树', '飞机', '电脑', 
  '手机', '书本', '椅子', '桌子', '香蕉', '西瓜', '老虎', '大象',
  '月亮', '星星', '雨伞', '篮球', '足球', '帽子', '鞋子', '衣服'
];
const GAME_STATE = {
  WAITING: 'waiting',
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
  MAX_HISTORY: 30  // 最大历史记录数
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
    // 撤销/重做历史栈
    historyStates: [],   // 存储绘画状态快照
    historyIndex: -1,
  };
  rooms.set(roomId, room);
  // 初始化历史状态
  saveHistoryState(room);
  return room;
}

function getOrCreateRoom(roomId, password) {
  let room = rooms.get(roomId);
  if (!room) {
    // 房间不存在，创建并设置密码（如果有传入）
    room = createRoom(roomId, password || null);
  } else {
    // 房间已存在，验证密码（如果房间有密码且传入密码不匹配）
    if (room.password && room.password !== password) {
      return { error: '密码错误' };
    }
  }
  return { room };
}

// 保存当前绘画状态到历史（用于撤销/重做）
function saveHistoryState(room) {
  const snapshot = JSON.parse(JSON.stringify(room.drawingData));
  // 如果当前索引不是最后一个，则删除之后的记录
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

// 撤销：恢复到上一个状态
function undoDrawing(room) {
  if (room.historyIndex > 0) {
    room.historyIndex--;
    room.drawingData = JSON.parse(JSON.stringify(room.historyStates[room.historyIndex]));
    return true;
  }
  return false;
}

// 重做：恢复到下一个状态
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

function startGameLogic(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.length < GAME_CONFIG.MIN_PLAYERS) return;
  if (room.players.length > GAME_CONFIG.MAX_PLAYERS) return;
  if (room.state !== GAME_STATE.WAITING) return;

  room.drawerIndex = Math.floor(Math.random() * room.players.length);
  room.players.forEach((player, index) => {
    player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
  });
  
  room.maxRounds = room.players.length;
  room.drawerHistory = [room.players[room.drawerIndex].id];
  room.state = GAME_STATE.DRAWING;
  room.currentRound = 1;
  room.guessedPlayers = [];
  room.roundStartTime = Date.now();
  room.timeLeft = GAME_CONFIG.ROUND_TIME;
  
  // 重置绘画数据与历史
  room.drawingData = { lines: [], clearCount: 0 };
  room.historyStates = [];
  room.historyIndex = -1;
  saveHistoryState(room);
  
  room.roundTimer = setInterval(() => {
    updateRoundTimer(roomId);
  }, 1000);

  io.to(roomId).emit('gameStarted', {
    drawer: room.players[room.drawerIndex],
    word: room.word,
    state: room.state,
    currentRound: room.currentRound,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
    players: room.players
  });
  
  broadcastCanvasFull(roomId);
  console.log(`房间 ${roomId} 游戏开始，画师: ${room.players[room.drawerIndex].username}`);
}

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  socket.on('joinRoom', (roomId, username, password) => {
    const {error,room} = getOrCreateRoom(roomId, password);
    if (error) {
      socket.emit('joinError', { message: error });
      return;
    }
    if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
      socket.emit('roomFull', { maxPlayers: GAME_CONFIG.MAX_PLAYERS });
      return;
    }
    
    const player = {
      id: socket.id,
      username: username || `玩家${room.players.length + 1}`,
      role: 'guesser',
      score: 0,
      isReady: false
    };
    
    room.players.push(player);
    socket.join(roomId);
    
    socket.emit('roomInfo', {
      roomId,
      players: room.players,
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
      players: room.players
    });

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
    io.to(roomId).emit('playerListUpdate', { players: room.players });
    checkAllReady(roomId);
  });

  // 绘图事件（增量更新，同时保存状态）
  socket.on('draw', (data) => {
    const { roomId, x, y, type, color, lineWidth } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    // 只有画图者可以绘图
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    
    if (type === 'start') {
      // 开始新线条
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
    // 广播全量更新给所有客户端（包括自己，保证同步）
    broadcastCanvasFull(roomId);
  });
  
  // 笔画结束，保存历史状态
  socket.on('drawEnd', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    saveHistoryState(room);
    broadcastCanvasFull(roomId);
  });
  
  // 清空画布
  socket.on('drawClear', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    // 保存当前状态到历史
    saveHistoryState(room);
    room.drawingData = { lines: [], clearCount: room.drawingData.clearCount + 1 };
    saveHistoryState(room); // 清空后再保存一次
    broadcastCanvasFull(roomId);
  });
  
  // 撤销
  socket.on('undo', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    if (undoDrawing(room)) {
      broadcastCanvasFull(roomId);
    }
  });
  
  // 重做
  socket.on('redo', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const drawerPlayer = room.players[room.drawerIndex];
    if (!drawerPlayer || drawerPlayer.id !== socket.id) return;
    if (redoDrawing(room)) {
      broadcastCanvasFull(roomId);
    }
  });

  socket.on('chatMessage', (data) => {
    const { roomId, message, username } = data;
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;
    
    if (sender.role === 'drawer' && room.state === GAME_STATE.DRAWING) {
      socket.emit('chatError', { message: '画师在画画期间不能发送聊天消息' });
      return;
    }

    const isCorrectGuess = message.includes(room.word) && room.state === GAME_STATE.DRAWING;
    
    if (isCorrectGuess) {
      handleCorrectGuess(room, socket.id, message);
      
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
        message,
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
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        const wasDrawer = (player.role === 'drawer');
        const hadBeenDrawer = room.drawerHistory.includes(player.id);
        
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          if (room.roundTimer) clearInterval(room.roundTimer);
          rooms.delete(roomId);
          return;
        }
        
        if (room.state === GAME_STATE.WAITING) {
          io.to(roomId).emit('playerLeft', {
            playerId: socket.id,
            players: room.players
          });
          checkAllReady(roomId);
          return;
        }
        
        if (!hadBeenDrawer && room.currentRound <= room.maxRounds) {
          room.maxRounds--;
        }
        
        if (room.players.length > 0) {
          if (wasDrawer) {
            if (room.roundTimer) clearInterval(room.roundTimer);
            room.state = GAME_STATE.FINISHED;
            io.to(roomId).emit('roundEnded', {
              word: room.word,
              guessedPlayers: room.guessedPlayers,
              drawer: player,
              players: room.players,
              currentRound: room.currentRound,
              maxRounds: room.maxRounds
            });
            if (room.currentRound >= room.maxRounds) {
              endGame(roomId);
              return;
            }
            setTimeout(() => {
              startNewRound(roomId);
            }, 3000);
          } else {
            if (playerIndex < room.drawerIndex) {
              room.drawerIndex--;
            }
            io.to(roomId).emit('playerLeft', {
              playerId: socket.id,
              players: room.players
            });
            room.players.forEach((p, idx) => {
              p.role = idx === room.drawerIndex ? 'drawer' : 'guesser';
            });
            io.to(roomId).emit('roleUpdate', { players: room.players });
          }
        }
        
        console.log(`${player.username} 离开了房间 ${roomId}`);
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

  console.log(`${player.username} 猜对了，获得${scoreToAdd}分，画师获得${GAME_CONFIG.DRAWER_SCORE}分`);
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

function startNewRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const nextDrawerIndex = getNextDrawerIndex(room);
  room.drawerIndex = nextDrawerIndex;
  
  room.players.forEach((player, index) => {
    player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
  });

  room.drawerHistory.push(room.players[room.drawerIndex].id);
  
  room.word = getRandomWord();
  room.drawingData = { lines: [], clearCount: 0 };
  room.guessedPlayers = [];
  room.state = GAME_STATE.DRAWING;
  room.roundStartTime = Date.now();
  room.timeLeft = GAME_CONFIG.ROUND_TIME;
  
  // 重置历史记录
  room.historyStates = [];
  room.historyIndex = -1;
  saveHistoryState(room);

  room.roundTimer = setInterval(() => {
    updateRoundTimer(roomId);
  }, 1000);

  io.to(roomId).emit('newRound', {
    drawer: room.players[room.drawerIndex],
    word: room.word,
    drawingData: room.drawingData,
    state: room.state,
    currentRound: room.currentRound,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
    players: room.players
  });
  
  broadcastCanvasFull(roomId);

  console.log(`房间 ${roomId} 第${room.currentRound}轮开始，画师: ${room.players[room.drawerIndex].username}`);
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
    totalRounds: room.maxRounds
  });

  console.log(`房间 ${roomId} 游戏结束，获胜者: ${winners.map(w => w.username).join(', ')}`);

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
  
  // 重置历史
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
    currentRound: room.currentRound,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
    state: room.state,
    chatHistory: room.chatHistory,
    drawingData: room.drawingData,
    config: GAME_CONFIG
  });
  
  broadcastCanvasFull(roomId);

  console.log(`房间 ${roomId} 已被重置`);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});