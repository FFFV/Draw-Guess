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
            <el-button type="danger" @click="clearCanvas" :disabled="!isDrawer">
              清空画布
            </el-button>
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
        <!-- 游戏信息卡片 -->
        <el-card class="game-info-card">
          <template #header>
            <span>游戏信息</span>
          </template>
          <div class="role-info">
            <h3>角色: 
              <el-tag v-if="role === 'drawer'" type="danger">🎨 画图者</el-tag>
              <el-tag v-else type="primary">🔍 猜词者</el-tag>
            </h3>
            <p v-if="isDrawer">你的题目: <span class="word">{{ currentWord }}</span></p>
            <p v-else>等待画图者画图...</p>
          </div>
          
          <div class="players-list">
            <h3>玩家列表</h3>
            <el-table :data="players" size="small" style="width: 100%">
              <el-table-column prop="username" label="玩家">
                <template #default="{ row }">
                  <span :class="{ drawer: row.role === 'drawer' }">
                    {{ row.username }}
                    <el-tag v-if="row.role === 'drawer'" type="danger" size="small">🎨</el-tag>
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="score" label="得分" sortable />
              <el-table-column label="状态" v-if="!isGameStarted">
                <template #default="{ row }">
                  <span v-if="row.id === socket?.id" class="ready-toggle">
                    <el-button size="small" @click="toggleReady" :disabled="isGameStarted">
                      {{ row.isReady ? '取消准备' : '准备' }}
                    </el-button>
                  </span>
                  <span v-else>
                    <el-tag v-if="row.isReady" type="success" size="small">✅ 已准备</el-tag>
                    <el-tag v-else type="info" size="small">⏳ 未准备</el-tag>
                  </span>
                </template>
              </el-table-column>
            </el-table>
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
        </el-card>

        <!-- 聊天卡片 -->
        <el-card class="chat-card">
          <template #header>
            <span>聊天</span>
          </template>
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
            <el-input
              v-model="chatMessage"
              placeholder="输入聊天消息或猜词..."
              @keyup.enter="sendMessage"
              :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)"
            />
            <el-button type="primary" @click="sendMessage" :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)">
              发送
            </el-button>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 加入房间模态框 -->
    <el-dialog v-model="showJoinDialog" title="加入游戏房间" width="500px" :close-on-click-modal="false">
      <el-form>
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="房间号">
          <el-input v-model="inputRoomId" placeholder="请输入房间号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showJoinDialog = false">取消</el-button>
        <el-button type="primary" @click="joinRoom">加入房间</el-button>
      </template>
      <p class="hint">提示: 和朋友们输入相同的房间号即可一起玩！</p>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import io from 'socket.io-client'
import { ElMessage } from 'element-plus'

// Socket.io 连接
const socket = ref(null)
const isConnected = ref(false)
const roomId = ref('')
const username = ref(`玩家${Math.floor(Math.random() * 1000)}`)
const inputRoomId = ref('room1')
const showJoinDialog = ref(true) // 控制弹窗显示

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
    ElMessage.error('请输入用户名和房间号')
    return
  }

  socket.value = io('http://localhost:3001')
  
  socket.value.on('connect', () => {
    isConnected.value = true
    showJoinDialog.value = false
    socket.value.emit('joinRoom', inputRoomId.value, username.value)
    roomId.value = inputRoomId.value
  })

  // 监听服务器事件（与之前相同，略）
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
    ElMessage.error(`房间已满，最多支持${data.maxPlayers}人同时游戏`)
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
    ElMessage.error(data.message)
  })

  socket.value.on('gameError', (data) => {
    ElMessage.error(data.message)
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
    const guessedNames = data.guessedPlayers.map(g => g.username).join(', ')
    const message = `第${data.currentRound}轮结束！词语是: ${data.word}<br/>猜对玩家: ${guessedNames || '无'}`
    ElMessage({
      message,
      dangerouslyUseHTMLString: true,
      type: 'info',
      duration: 5000
    })
    players.value = data.players
    guessedPlayers.value = []
  })

  socket.value.on('gameEnded', (data) => {
    isGameStarted.value = false
    isGameFinished.value = true
    const winners = data.winners.map(w => w.username).join(', ')
    const scores = data.finalScores.map(s => `${s.username}: ${s.score}分`).join('<br/>')
    const message = `游戏结束！<br/><br/>获胜者: ${winners}<br/><br/>最终得分:<br/>${scores}`
    ElMessage({
      message,
      dangerouslyUseHTMLString: true,
      type: 'success',
      duration: 0,
      showClose: true
    })
    players.value = data.players
  })

  socket.value.on('disconnect', () => {
    isConnected.value = false
    roomId.value = ''
    showJoinDialog.value = true
  })

  socket.value.on('gameReset', (data) => {
  // 更新房间数据
  players.value = data.players;
  roomId.value = data.roomId;
  currentRound.value = data.currentRound;
  maxRounds.value = data.maxRounds;
  timeLeft.value = data.timeLeft;
  chatHistory.value = data.chatHistory;
  drawingData.value = data.drawingData;
  
  // 重置游戏状态
  isGameStarted.value = false;
  isGameFinished.value = false;
  role.value = '';          // 重置角色
  currentWord.value = '';   // 清空当前词语
  guessedPlayers.value = [];
  
  // 重置画布并重绘
  clearCanvas(false);
  redrawCanvas(data.drawingData);
  
  // 滚动聊天到底部
  scrollChatToBottom();
  
  });
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
/* 保留原有样式，可根据需要微调 */
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

/* 卡片覆盖样式，使其背景半透 */
.game-info-card,
.chat-card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(5px);
  border-radius: 15px;
  border: none;
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

.chat-messages {
  height: 300px;
  overflow-y: auto;
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