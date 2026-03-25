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

// 新规则配置
const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  ROUND_TIME: 90, // 90秒
  DRAWER_SCORE: 3, // 画师固定得分
  GUESSER_SCORES: [10, 8, 6, 4, 2], // 猜对者递减分数
  TOTAL_ROUNDS: 10 // 总轮数
};

// 游戏房间数据
const rooms = new Map();

// 生成随机单词
function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// 创建新房间
function createRoom(roomId) {
  const room = {
    id: roomId,
    players: [],
    drawerIndex: 0,
    word: getRandomWord(),
    state: GAME_STATE.WAITING,
    chatHistory: [],
    drawingData: {
      lines: [],
      clearCount: 0
    },
    // 新规则相关字段
    roundTimer: null,
    roundStartTime: null,
    timeLeft: GAME_CONFIG.ROUND_TIME,
    currentRound: 0,
    maxRounds: GAME_CONFIG.TOTAL_ROUNDS,
    guessedPlayers: [], // 本轮已猜对的玩家
    isGameFinished: false
  };
  rooms.set(roomId, room);
  return room;
}

// 获取房间或创建
function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
  }
  return room;
}

// Socket.io 连接处理
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 加入房间
  socket.on('joinRoom', (roomId, username) => {
    const room = getOrCreateRoom(roomId);
    
    // 检查人数限制
    if (room.players.length >= GAME_CONFIG.MAX_PLAYERS) {
      socket.emit('roomFull', { maxPlayers: GAME_CONFIG.MAX_PLAYERS });
      return;
    }
    
    const player = {
      id: socket.id,
      username: username || `玩家${room.players.length + 1}`,
      role: 'guesser', // 初始都为猜词者，游戏开始后随机分配画师
      score: 0,
      isReady: false
    };
    
    room.players.push(player);
    socket.join(roomId);
    
    // 发送房间信息给新玩家
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

    // 广播给房间内其他玩家
    socket.to(roomId).emit('playerJoined', {
      player,
      players: room.players
    });

    console.log(`${player.username} 加入了房间 ${roomId}`);
  });

  // 处理画画数据
  socket.on('draw', (data) => {
    const { roomId, x, y, type } = data;
    const room = rooms.get(roomId);
    if (!room) return;

    if (type === 'start') {
      room.drawingData.lines.push({ points: [{ x, y }], color: data.color });
    } else if (type === 'move') {
      const currentLine = room.drawingData.lines[room.drawingData.lines.length - 1];
      if (currentLine) {
        currentLine.points.push({ x, y });
      }
    } else if (type === 'clear') {
      room.drawingData.lines = [];
      room.drawingData.clearCount++;
    }

    // 广播画画数据给房间内其他玩家
    socket.to(roomId).emit('drawingUpdate', data);
  });

  // 处理聊天消息
  socket.on('chatMessage', (data) => {
    const { roomId, message, username } = data;
    const room = rooms.get(roomId);
    if (!room) return;

    // 检查发送者是否是画师
    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;
    
    // 规则4: 画师仅能画画，禁止发送任何聊天消息
    if (sender.role === 'drawer' && room.state === GAME_STATE.DRAWING) {
      socket.emit('chatError', { message: '画师在画画期间不能发送聊天消息' });
      return;
    }

    // 检查是否猜对了
    const isCorrectGuess = message.includes(room.word) && room.state === GAME_STATE.DRAWING;
    
    if (isCorrectGuess) {
      // 规则5: 答案保护 - 猜对的内容不对外公开显示
      // 规则6: 计分规则处理
      handleCorrectGuess(room, socket.id, message);
      
      // 发送系统消息提示猜对
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
      
      // 检查是否需要结束本轮
      if (room.guessedPlayers.length >= room.players.length - 1) {
        // 所有猜词者都猜对了，结束本轮
        endRound(roomId);
      }
    } else {
      // 普通聊天消息
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
  
  // 开始游戏
  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    // 规则1: 参与人数检查
    if (!room || room.players.length < GAME_CONFIG.MIN_PLAYERS) {
      socket.emit('gameError', { message: `需要至少${GAME_CONFIG.MIN_PLAYERS}名玩家才能开始游戏` });
      return;
    }
    
    if (room.players.length > GAME_CONFIG.MAX_PLAYERS) {
      socket.emit('gameError', { message: `最多支持${GAME_CONFIG.MAX_PLAYERS}名玩家` });
      return;
    }

    // 规则2: 游戏开始后系统随机选定首位画师
    room.drawerIndex = Math.floor(Math.random() * room.players.length);
    // 设置所有玩家角色
    room.players.forEach((player, index) => {
      player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
    });
    
    room.state = GAME_STATE.DRAWING;
    room.currentRound = 1;
    room.guessedPlayers = [];
    room.roundStartTime = Date.now();
    room.timeLeft = GAME_CONFIG.ROUND_TIME;
    
    // 启动倒计时
    room.roundTimer = setInterval(() => {
      updateRoundTimer(roomId);
    }, 1000);

    // 通知所有玩家
    io.to(roomId).emit('gameStarted', {
      drawer: room.players[room.drawerIndex],
      word: room.word,
      state: room.state,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      timeLeft: room.timeLeft,
      players: room.players
    });

    console.log(`房间 ${roomId} 游戏开始，画师: ${room.players[room.drawerIndex].username}`);
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    // 从所有房间中移除用户
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players.splice(playerIndex, 1);
        
        // 如果房间空了，删除房间
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // 更新角色
          if (room.drawerIndex >= room.players.length) {
            room.drawerIndex = 0;
          }
          
          // 广播玩家离开
          io.to(roomId).emit('playerLeft', {
            playerId: socket.id,
            players: room.players
          });
        }
        
        console.log(`${player.username} 离开了房间 ${roomId}`);
      }
    });
  });
});

// 处理猜对答案
function handleCorrectGuess(room, playerId, guessMessage) {
  // 检查玩家是否已经猜对过
  if (room.guessedPlayers.some(p => p.playerId === playerId)) {
    return;
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  // 规则6: 猜对玩家积分递减
  const guesserIndex = room.guessedPlayers.length;
  const scoreIndex = Math.min(guesserIndex, GAME_CONFIG.GUESSER_SCORES.length - 1);
  const scoreToAdd = GAME_CONFIG.GUESSER_SCORES[scoreIndex];
  
  player.score += scoreToAdd;
  
  // 记录已猜对玩家
  room.guessedPlayers.push({
    playerId,
    username: player.username,
    scoreAdded: scoreToAdd,
    guessMessage,
    timestamp: Date.now()
  });

  // 规则6: 只要有人猜对，画师固定+3分
  const drawer = room.players[room.drawerIndex];
  if (drawer && room.guessedPlayers.length === 1) {
    // 只有第一次有人猜对时给画师加分
    drawer.score += GAME_CONFIG.DRAWER_SCORE;
  }

  // 通知所有玩家分数更新
  io.to(room.id).emit('scoreUpdate', {
    players: room.players,
    guessedPlayers: room.guessedPlayers
  });

  console.log(`${player.username} 猜对了，获得${scoreToAdd}分，画师获得${GAME_CONFIG.DRAWER_SCORE}分`);
}

// 更新回合倒计时
function updateRoundTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== GAME_STATE.DRAWING || !room.roundStartTime) return;

  const elapsedSeconds = Math.floor((Date.now() - room.roundStartTime) / 1000);
  room.timeLeft = Math.max(0, GAME_CONFIG.ROUND_TIME - elapsedSeconds);

  // 每秒发送时间更新
  io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft });

  // 时间到，结束本轮
  if (room.timeLeft <= 0) {
    endRound(roomId);
  }
}

// 结束本轮
function endRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // 清除倒计时
  if (room.roundTimer) {
    clearInterval(room.roundTimer);
    room.roundTimer = null;
  }

  room.state = GAME_STATE.FINISHED;
  
  // 规则6: 无人猜对则所有人均不加分
  // 已在 handleCorrectGuess 中处理

  // 规则7: 检查是否完成指定轮数
  room.currentRound++;
  
  // 发送本轮结果
  io.to(roomId).emit('roundEnded', {
    word: room.word,
    guessedPlayers: room.guessedPlayers,
    drawer: room.players[room.drawerIndex],
    players: room.players,
    currentRound: room.currentRound - 1, // 刚结束的轮次
    maxRounds: room.maxRounds
  });

  // 检查游戏是否结束
  if (room.currentRound > room.maxRounds) {
    endGame(roomId);
    return;
  }

  // 等待3秒后开始新回合
  setTimeout(() => {
    startNewRound(roomId);
  }, 3000);
}

// 开始新回合
function startNewRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // 规则2: 本轮结束后按顺序轮流担任画师
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  
  // 更新所有玩家角色
  room.players.forEach((player, index) => {
    player.role = index === room.drawerIndex ? 'drawer' : 'guesser';
  });

  room.word = getRandomWord();
  room.drawingData = { lines: [], clearCount: 0 };
  room.guessedPlayers = [];
  room.state = GAME_STATE.DRAWING;
  room.roundStartTime = Date.now();
  room.timeLeft = GAME_CONFIG.ROUND_TIME;

  // 启动倒计时
  room.roundTimer = setInterval(() => {
    updateRoundTimer(roomId);
  }, 1000);

  // 通知所有玩家
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

  console.log(`房间 ${roomId} 第${room.currentRound}轮开始，画师: ${room.players[room.drawerIndex].username}`);
}

// 结束游戏
function endGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.state = GAME_STATE.FINISHED;
  room.isGameFinished = true;

  // 规则7: 完成指定轮数后，总分最高的玩家获胜
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

  // 发送游戏结束通知
  io.to(roomId).emit('gameEnded', {
    players: room.players,
    winners: winners,
    finalScores: room.players.map(p => ({ username: p.username, score: p.score })),
    totalRounds: room.maxRounds
  });

  console.log(`房间 ${roomId} 游戏结束，获胜者: ${winners.map(w => w.username).join(', ')}`);
}

// 启动服务器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});