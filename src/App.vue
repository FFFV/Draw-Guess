<template>
  <div class="game-container">
    <div class="header">
      <h1>🎨 多人你画我猜</h1>
      <div class="room-info">
        <span v-if="roomId">房间: {{ roomId }}</span>
        <span v-else>未加入房间</span>
        <span class="players-count">在线玩家: {{ players.length }}</span>
        <div v-if="isGameStarted" class="game-stats">
          <span class="round-info">第 {{ currentRound }}/{{ maxRounds }} 轮</span>
          <span class="timer" :class="{ warning: timeLeft <= 10 }">
            ⏱️ {{ Math.floor(timeLeft / 60) }}:{{ (timeLeft % 60).toString().padStart(2, '0') }}
          </span>
        </div>
      </div>
    </div>

    <div class="game-content">
      <!-- 左侧画布区域 -->
      <div class="left-panel">
        <div class="canvas-container">
          <canvas 
            ref="canvas" 
            width="800" 
            height="500"
            @mousedown="startDrawing"
            @mousemove="draw"
            @mouseup="stopDrawing"
            @mouseleave="stopDrawing"
          ></canvas>
          <div class="canvas-controls">
            <button @click="clearCanvas" :disabled="!isDrawer">清空画布</button>
            <div class="color-picker">
              <div 
                v-for="color in colors" 
                :key="color"
                :style="{ backgroundColor: color }"
                :class="{ active: selectedColor === color }"
                @click="selectColor(color)"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧控制区域 -->
      <div class="right-panel">
        <!-- 游戏信息 -->
        <div class="game-info">
          <div class="role-info">
            <h3>角色: {{ role === 'drawer' ? '🎨 画图者' : '🔍 猜词者' }}</h3>
            <p v-if="isDrawer">你的题目: <span class="word">{{ currentWord }}</span></p>
            <p v-else>等待画图者画图...</p>
          </div>
          
          <div class="players-list">
            <h3>玩家列表</h3>
            <div class="player-item" v-for="player in players" :key="player.id">
              <span :class="{ drawer: player.role === 'drawer' }">
                {{ player.username }}
                <span v-if="player.role === 'drawer'">🎨</span>
              </span>
              <span class="score">得分: {{ player.score }}</span>
              <span v-if="!isGameStarted" class="ready-status">
                <span v-if="player.id === socket?.id" class="ready-toggle">
                  <button @click="toggleReady" :disabled="isGameStarted">
                    {{ player.isReady ? '取消准备' : '准备' }}
                  </button>
                </span>
                <span v-else>
                  {{ player.isReady ? '✅ 已准备' : '⏳ 未准备' }}
                </span>
              </span>
            </div>
          </div>

          <div class="game-controls" v-if="!isGameStarted">
            <div v-if="players.length >= 2" class="ready-status-message">
              <p v-if="!allPlayersReady">等待所有玩家准备... ({{ readyCount }}/{{ players.length }})</p>
              <p v-else>所有玩家已准备，游戏即将开始...</p>
            </div>
            <div v-else>
              <p>需要至少2名玩家才能开始游戏</p>
            </div>
          </div>
        </div>

        <!-- 聊天区域 -->
        <div class="chat-container">
          <h3>聊天室</h3>
          <div class="chat-messages" ref="chatMessages">
            <div 
              v-for="msg in chatHistory" 
              :key="msg.id"
              :class="['chat-message', { correct: msg.isCorrect }]"
            >
              <span class="username">{{ msg.username }}:</span>
              <span class="message">{{ msg.message }}</span>
              <span class="time">{{ msg.timestamp }}</span>
              <span v-if="msg.isCorrect" class="correct-badge">✅ 猜对了！</span>
            </div>
          </div>
          <div class="chat-input">
            <input 
              v-model="chatMessage" 
              @keyup.enter="sendMessage"
              :placeholder="isDrawer ? '画师不能发送消息' : '输入聊天消息或猜词...'"
              :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)"
            />
            <button @click="sendMessage" :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)">发送</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 加入房间模态框 -->
    <div class="modal" v-if="!isConnected">
      <div class="modal-content">
        <h2>加入游戏房间</h2>
        <div class="form-group">
          <label>用户名:</label>
          <input v-model="username" placeholder="请输入用户名" />
        </div>
        <div class="form-group">
          <label>房间号:</label>
          <input v-model="inputRoomId" placeholder="请输入房间号" />
        </div>
        <button @click="joinRoom" class="join-btn">加入房间</button>
        <p class="hint">提示: 和朋友们输入相同的房间号即可一起玩！</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import io from 'socket.io-client'

// Socket.io 连接
const socket = ref(null)
const isConnected = ref(false)
const roomId = ref('')
const username = ref(`玩家${Math.floor(Math.random() * 1000)}`)
const inputRoomId = ref('room1')

// 游戏状态
const players = ref([])
const role = ref('')
const currentWord = ref('')
const isGameStarted = ref(false)
const chatHistory = ref([])
const chatMessage = ref('')
const currentRound = ref(1)
const maxRounds = ref(10)
const timeLeft = ref(90)
const guessedPlayers = ref([])
const isGameFinished = ref(false)

// 画布相关
const canvas = ref(null)
const ctx = ref(null)
const isDrawing = ref(false)
const selectedColor = ref('#000000')
const colors = ['#000000', '#ff3b30', '#ff9500', '#ffcc00', '#4cd964', '#5ac8fa', '#007aff', '#5856d6']

// 当前画图数据
const drawingData = ref({
  lines: [],
  clearCount: 0
})

// 计算属性
const isDrawer = computed(() => role.value === 'drawer')
const allPlayersReady = computed(() => {
  return players.value.length >= 2 && players.value.every(p => p.isReady)
})
const readyCount = computed(() => {
  return players.value.filter(p => p.isReady).length
})

// 加入房间
const joinRoom = () => {
  if (!username.value.trim() || !inputRoomId.value.trim()) {
    alert('请输入用户名和房间号')
    return
  }

  socket.value = io('http://localhost:3001')
  
  socket.value.on('connect', () => {
    isConnected.value = true
    socket.value.emit('joinRoom', inputRoomId.value, username.value)
    roomId.value = inputRoomId.value
  })

  // 监听服务器事件
  socket.value.on('roomInfo', (data) => {
    players.value = data.players
    role.value = data.players.find(p => p.id === socket.value.id)?.role || ''
    currentWord.value = data.word || ''
    chatHistory.value = data.chatHistory
    drawingData.value = data.drawingData
    currentRound.value = data.currentRound || 1
    maxRounds.value = data.maxRounds || 10
    timeLeft.value = data.timeLeft || 90
    redrawCanvas(data.drawingData)
  })

  socket.value.on('roomFull', (data) => {
    alert(`房间已满，最多支持${data.maxPlayers}人同时游戏`)
  })

  socket.value.on('playerJoined', (data) => {
    players.value = data.players
  })

  socket.value.on('playerLeft', (data) => {
    players.value = data.players
  })

  socket.value.on('playerListUpdate', (data) => {
    players.value = data.players
  })

  socket.value.on('drawingUpdate', (data) => {
    handleDrawingUpdate(data)
  })

  socket.value.on('chatMessage', (msg) => {
    chatHistory.value.push(msg)
    scrollChatToBottom()
  })

  socket.value.on('chatError', (data) => {
    alert(data.message)
  })

  socket.value.on('gameError', (data) => {
    alert(data.message)
  })

  socket.value.on('gameStarted', (data) => {
    isGameStarted.value = true
    isGameFinished.value = false
    players.value = data.players
    role.value = data.players.find(p => p.id === socket.value.id)?.role || ''
    currentWord.value = role.value === 'drawer' ? data.word : ''
    currentRound.value = data.currentRound
    maxRounds.value = data.maxRounds
    timeLeft.value = data.timeLeft
    guessedPlayers.value = []
  })

  socket.value.on('newRound', (data) => {
    players.value = data.players
    role.value = data.players.find(p => p.id === socket.value.id)?.role || ''
    currentWord.value = role.value === 'drawer' ? data.word : ''
    drawingData.value = data.drawingData
    currentRound.value = data.currentRound
    timeLeft.value = data.timeLeft
    guessedPlayers.value = []
    clearCanvas(false)
    redrawCanvas(data.drawingData)
  })

  socket.value.on('timerUpdate', (data) => {
    timeLeft.value = data.timeLeft
  })

  socket.value.on('scoreUpdate', (data) => {
    players.value = data.players
    guessedPlayers.value = data.guessedPlayers
  })

  socket.value.on('roundEnded', (data) => {
    const resultMsg = `第${data.currentRound}轮结束！词语是: ${data.word}
    猜对玩家: ${data.guessedPlayers.map(g => g.username).join(', ')}`
    alert(resultMsg)
    players.value = data.players
    guessedPlayers.value = []
  })

  socket.value.on('gameEnded', (data) => {
    isGameStarted.value = false
    isGameFinished.value = true
    const winners = data.winners.map(w => w.username).join(', ')
    const scores = data.finalScores.map(s => `${s.username}: ${s.score}分`).join('\n')
    alert(`游戏结束！\n\n获胜者: ${winners}\n\n最终得分:\n${scores}`)
    players.value = data.players
  })

  socket.value.on('disconnect', () => {
    isConnected.value = false
    roomId.value = ''
  })
}

// 切换准备状态
const toggleReady = () => {
  if (socket.value && !isGameStarted.value) {
    socket.value.emit('toggleReady', roomId.value)
  }
}

// 画布初始化
onMounted(() => {
  ctx.value = canvas.value.getContext('2d')
  ctx.value.lineWidth = 3
  ctx.value.lineCap = 'round'
  ctx.value.lineJoin = 'round'
})

// 开始绘制
const startDrawing = (e) => {
  if (!isDrawer.value || !isConnected.value) return
  
  const rect = canvas.value.getBoundingClientRect()
  const scaleX = canvas.value.width / rect.width
  const scaleY = canvas.value.height / rect.height
  const x = (e.clientX - rect.left) * scaleX
  const y = (e.clientY - rect.top) * scaleY
  
  isDrawing.value = true
  lastX.value = x
  lastY.value = y
  
  if (socket.value) {
    socket.value.emit('draw', {
      roomId: roomId.value,
      x,
      y,
      type: 'start',
      color: selectedColor.value
    })
  }
}

// 绘制
const draw = (e) => {
  if (!isDrawing.value || !isDrawer.value) return
  
  const rect = canvas.value.getBoundingClientRect()
  const scaleX = canvas.value.width / rect.width
  const scaleY = canvas.value.height / rect.height
  const x = (e.clientX - rect.left) * scaleX
  const y = (e.clientY - rect.top) * scaleY
  
  if (lastX.value === null || lastY.value === null) {
    lastX.value = x
    lastY.value = y
    return
  }
  
  ctx.value.strokeStyle = selectedColor.value
  ctx.value.lineWidth = 3
  ctx.value.beginPath()
  ctx.value.moveTo(lastX.value, lastY.value)
  ctx.value.lineTo(x, y)
  ctx.value.stroke()
  
  if (socket.value) {
    socket.value.emit('draw', {
      roomId: roomId.value,
      x,
      y,
      type: 'move',
      color: selectedColor.value
    })
  }
  
  lastX.value = x
  lastY.value = y
}

// 停止绘制
const stopDrawing = () => {
  isDrawing.value = false
  lastX.value = null
  lastY.value = null
}

// 清空画布
const clearCanvas = (emitEvent = true) => {
  ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
  if (emitEvent && socket.value && isDrawer.value) {
    socket.value.emit('draw', {
      roomId: roomId.value,
      type: 'clear'
    })
  }
}

// 选择颜色
const selectColor = (color) => {
  selectedColor.value = color
}

// 处理远程绘制更新
const handleDrawingUpdate = (data) => {
  ctx.value.lineWidth = 3
  ctx.value.lineCap = 'round'
  ctx.value.lineJoin = 'round'
  
  if (data.type === 'start') {
    ctx.value.strokeStyle = data.color
    ctx.value.beginPath()
    ctx.value.moveTo(data.x, data.y)
  } else if (data.type === 'move') {
    ctx.value.lineTo(data.x, data.y)
    ctx.value.stroke()
  } else if (data.type === 'clear') {
    ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
  }
}

// 重新绘制画布
const redrawCanvas = (data) => {
  ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.value.lineWidth = 3
  ctx.value.lineCap = 'round'
  ctx.value.lineJoin = 'round'
  
  data.lines.forEach(line => {
    if (line.points.length > 0) {
      ctx.value.strokeStyle = line.color || '#000000'
      ctx.value.beginPath()
      ctx.value.moveTo(line.points[0].x, line.points[0].y)
      for (let i = 1; i < line.points.length; i++) {
        ctx.value.lineTo(line.points[i].x, line.points[i].y)
      }
      ctx.value.stroke()
    }
  })
}

// 发送聊天消息
const sendMessage = () => {
  if (!chatMessage.value.trim() || !socket.value) return
  socket.value.emit('chatMessage', {
    roomId: roomId.value,
    message: chatMessage.value,
    username: username.value
  })
  chatMessage.value = ''
}

// 滚动聊天到底部
const scrollChatToBottom = () => {
  nextTick(() => {
    const chatMessages = document.querySelector('.chat-messages')
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
  })
}

// 监听聊天历史变化
watch(chatHistory, scrollChatToBottom, { deep: true })

// 最后位置记录
const lastX = ref(null)
const lastY = ref(null)

// 清理
onUnmounted(() => {
  if (socket.value) {
    socket.value.disconnect()
  }
})
</script>

<style scoped>
.game-container {
  max-width: 1400px;
  margin: 0 auto;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 15px;
  padding: 20px 30px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.header h1 {
  color: white;
  font-size: 2rem;
  margin: 0;
}

.room-info {
  display: flex;
  gap: 20px;
  color: white;
  font-size: 1.1rem;
  align-items: center;
}

.players-count {
  background: rgba(255, 255, 255, 0.2);
  padding: 5px 15px;
  border-radius: 20px;
}

.game-stats {
  display: flex;
  gap: 20px;
  margin-left: 20px;
}

.round-info {
  background: rgba(52, 152, 219, 0.3);
  padding: 5px 15px;
  border-radius: 20px;
  color: white;
  font-weight: bold;
}

.timer {
  background: rgba(46, 204, 113, 0.3);
  padding: 5px 15px;
  border-radius: 20px;
  color: white;
  font-weight: bold;
}

.timer.warning {
  background: rgba(231, 76, 60, 0.3);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.7; }
  100% { opacity: 1; }
}

.game-content {
  display: flex;
  flex: 1;
  gap: 20px;
  height: calc(100vh - 120px);
}

.left-panel {
  flex: 3;
  display: flex;
  flex-direction: column;
}

.right-panel {
  flex: 1;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.canvas-container {
  background: white;
  border-radius: 15px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  flex: 1;
  display: flex;
  flex-direction: column;
}

canvas {
  flex: 1;
  cursor: crosshair;
  background: #f8f9fa;
}

.canvas-controls {
  background: #2c3e50;
  padding: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.canvas-controls button {
  background: #e74c3c;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s;
}

.canvas-controls button:hover:not(:disabled) {
  background: #c0392b;
}

.canvas-controls button:disabled {
  background: #7f8c8d;
  cursor: not-allowed;
}

.color-picker {
  display: flex;
  gap: 10px;
}

.color-picker div {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.2s;
}

.color-picker div:hover {
  transform: scale(1.2);
}

.color-picker div.active {
  border-color: white;
  transform: scale(1.2);
}

.game-info {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 15px;
  padding: 20px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
}

.role-info h3 {
  margin-top: 0;
  color: #2c3e50;
}

.word {
  display: inline-block;
  background: #3498db;
  color: white;
  padding: 8px 15px;
  border-radius: 10px;
  font-size: 1.2rem;
  font-weight: bold;
  margin-left: 10px;
}

.players-list {
  margin: 20px 0;
}

.players-list h3 {
  color: #2c3e50;
  margin-bottom: 10px;
}

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 8px;
}

.player-item .drawer {
  color: #e74c3c;
  font-weight: bold;
}

.score {
  color: #27ae60;
  font-weight: bold;
}

.ready-status {
  margin-left: 10px;
  font-size: 0.9rem;
}
.ready-toggle button {
  background: #3498db;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}
.ready-toggle button:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}
.ready-status-message {
  margin-top: 10px;
  text-align: center;
  font-size: 0.9rem;
  color: #2c3e50;
}

.game-controls {
  margin-top: 20px;
}

.chat-container {
  flex: 1;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 15px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
  margin-bottom: 15px;
  padding-right: 10px;
}

.chat-message {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: #f8f9fa;
  border-radius: 8px;
  animation: fadeIn 0.3s;
}

.chat-message.correct {
  background: #d4edda;
  border: 1px solid #c3e6cb;
}

.username {
  font-weight: bold;
  color: #3498db;
  margin-right: 5px;
}

.message {
  color: #333;
}

.time {
  display: block;
  font-size: 0.8rem;
  color: #95a5a6;
  margin-top: 2px;
}

.correct-badge {
  display: inline-block;
  background: #28a745;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  margin-left: 10px;
}

.chat-input {
  display: flex;
  gap: 10px;
}

.chat-input input {
  flex: 1;
  padding: 12px;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
}

.chat-input button {
  padding: 12px 24px;
  background: #27ae60;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.3s;
}

.chat-input button:hover:not(:disabled) {
  background: #219955;
}

.chat-input button:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 40px;
  border-radius: 20px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-content h2 {
  color: #2c3e50;
  margin-bottom: 30px;
  text-align: center;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #34495e;
  font-weight: bold;
}

.form-group input {
  width: 100%;
  padding: 12px;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.form-group input:focus {
  border-color: #3498db;
  outline: none;
}

.join-btn {
  width: 100%;
  padding: 15px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 1.2rem;
  font-weight: bold;
  cursor: pointer;
  transition: transform 0.2s;
}

.join-btn:hover {
  transform: translateY(-2px);
}

.hint {
  text-align: center;
  color: #7f8c8d;
  margin-top: 20px;
  font-size: 0.9rem;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}

@media (max-width: 1200px) {
  .game-content {
    flex-direction: column;
  }
  
  .left-panel, .right-panel {
    width: 100%;
  }
  
  canvas {
    height: 500px;
  }
}
</style>