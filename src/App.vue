<template>
  <div class="game-container">
    <div class="header">
      <h1>🎨 你画我猜</h1>
        <div class="room-info">
          <div v-if="roomId" class="room-badge">
            <el-tag type="info" size="large" round>
              <span>房间: {{ roomId }}</span>
              <el-icon @click="copyRoomId" title="复制房间号" size="10"><DocumentCopy /></el-icon>
            </el-tag>
            <!-- 房主锁定按钮 -->
            <el-button 
              v-if="isRoomOwner" 
              :type="isRoomLocked ? 'danger' : 'success'" 
              size="small" 
              @click="toggleRoomLock"
              :disabled="isGameStarted"
              class="lock-btn"
            >
              {{ isRoomLocked ? '🔓 解锁房间' : '🔒 锁定房间' }}
            </el-button>
          </div>
          <el-button v-else type="primary" @click="showJoinDialog = true">
            加入房间
          </el-button>
          <el-tag type="success" :disable-transitions="true" size="large" :round="true">在线玩家: {{ players.length }}</el-tag>
          <div v-if="isGameStarted" class="game-stats">
            <el-tag type="warning" :disable-transitions="true" size="large" :round="true">第 {{ currentRound }}/{{ maxRounds }} 轮</el-tag>
            <el-tag :type="timeLeft <= 10 ? 'danger' : 'primary'" class="timer" :class="{ warning: timeLeft <= 10 }" size="large" :round="true" :disable-transitions="true">
              ⏱️{{ Math.floor(timeLeft / 60) }}:{{ (timeLeft % 60).toString().padStart(2, '0') }}
            </el-tag>
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
            @touchstart.prevent="onTouchStart"
            @touchmove.prevent="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchEnd"
          ></canvas>
          <div class="canvas-controls">
            <div class="tool-buttons">
              <el-button type="danger" @click="clearCanvas" :disabled="!isDrawer" size="default">
                清空画布
              </el-button>
              <el-button 
                :type="eraserMode ? 'warning' : 'default'" 
                @click="toggleEraser" 
                :disabled="!isDrawer"
                class="eraser-btn"
                size="default">
                {{ eraserMode ? '✏️ 绘画' : '🧽 橡皮擦' }}
              </el-button>
              <el-button 
                type="info" 
                @click="undo" 
                :disabled="!isDrawer || !canUndo"
                class="undo-btn"
                size="default">
                ↩️ 撤销
              </el-button>
              <el-button 
                type="info" 
                @click="redo" 
                :disabled="!isDrawer || !canRedo"
                class="redo-btn"
                size="default">
                ↪️ 重做
              </el-button>
            </div>
            <div class="brush-control">
              <span class="brush-label">画笔粗细: {{ brushSize }}px</span>
              <el-slider 
                v-model="brushSize" 
                :min="1" 
                :max="10" 
                :disabled="!isDrawer"
                style="width: 120px; margin: 0 12px;"
                @change="handleBrushSizeChange"
              />
            </div>
            <div class="color-picker">
              <div 
                v-for="color in colors" 
                :key="color"
                :style="{ backgroundColor: color }"
                :class="{ active: selectedColor === color && !eraserMode }"
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
          <div class="role-info">
            <h3>角色: 
              <el-tag v-if="role === 'drawer'" type="danger">🎨 画图者</el-tag>
              <el-tag v-else type="primary">🔍 猜词者</el-tag>
            </h3>
            <p v-if="isDrawer" style="margin-top: 5px;">你的题目: <span class="word">{{ currentWord }}</span></p>
            <p v-if="!isDrawer && allPlayersReady">等待画图者画图...</p>
          </div>
          
          <div class="players-list">
            <h3>玩家列表</h3>
            <el-table :data="players" size="small" style="width: 100%" empty-text="当前房间玩家为空" class="players-table">
              <el-table-column prop="username" label="玩家">
                <template #default="{ row }">
                  <span :class="{ drawer: row.role === 'drawer' }">
                    {{ row.username }}
                    <el-tag v-if="row.role === 'drawer'" type="danger" size="small">🎨</el-tag>
                    <el-tag v-if="row.id === roomOwnerId" type="warning" size="small" style="margin-left: 5px">👑房主</el-tag>
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
              <!-- 房主管理列 -->
              <el-table-column label="管理" v-if="isRoomOwner && !isGameStarted">
                <template #default="{ row }">
                  <el-button 
                    v-if="row.id !== socket?.id" 
                    size="small" 
                    type="danger" 
                    @click="kickPlayer(row.id, row.username)"
                  >
                    踢出
                  </el-button>
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
              :class="['chat-message', { correct: msg.correctGuess }]"
            >
              <span class="username">{{ msg.username }}:</span>
              <span class="message">{{ msg.message }}</span>
              <span class="time">{{ msg.timestamp }}</span>
              <span v-if="msg.correctGuess" class="correct-badge">✅ 猜对了！</span>
            </div>
          </div>
          <div class="chat-input">
            <el-input
              v-model="chatMessage"
              placeholder="输入聊天消息或猜词..."
              @keyup.enter="sendMessage"
              :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)"
              maxlength="100"
              show-word-limit
            />
            <el-button type="primary" @click="sendMessage" :disabled="!isConnected || (isDrawer && isGameStarted && !isGameFinished)">
              发送
            </el-button>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 加入房间模态框 -->
    <el-dialog v-model="showJoinDialog" title="加入游戏房间" width="500px" :close-on-click-modal="false" align-center class="join-dialog">
      <el-alert style="margin-bottom: 20px;" title="和朋友们输入相同的房间号即可一起玩！如果房间设置了密码，需要输入正确密码。" type="primary" :closable="false" show-icon/>
      <el-form>
        <el-form-item label="用户名" :required="true">
          <el-input v-model="username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="房间号" :required="true">
          <el-input v-model="inputRoomId" placeholder="请输入房间号" />
        </el-form-item>
        <el-form-item label="房间密码">
          <el-input v-model="roomPassword" placeholder="如果房间设置了密码，请输入" type="password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showJoinDialog = false">取消</el-button>
        <el-button type="primary" @click="joinRoom">加入房间</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import type { Socket } from 'socket.io-client'
import io from 'socket.io-client'
import { ElMessage } from 'element-plus'
import { ElMessageBox } from 'element-plus'
import { validateUsername, validateRoomId, validateRoomPassword, sanitizeInput, validateChatMessage } from './utils/validation'
import type { 
  Player, 
  ChatMessage, 
  DrawingData, 
  DrawingLine,
  GuessedPlayer,
  ServerRoomInfo,
  ServerJoinError
} from '@/types/game'
import type { ServerEvents } from '@/types/socket-events'

// Socket.io 连接
const socket = ref<Socket | null>(null)
const isConnected = ref(false)
const roomId = ref('')
const username = ref(`玩家${Math.floor(Math.random() * 1000)}`)
const inputRoomId = ref('room1')
const showJoinDialog = ref(true) // 控制弹窗显示
const roomPassword = ref('')

// 游戏状态
const players = ref<Player[]>([])
const role = ref<'drawer' | 'guesser' | ''>('')
const currentWord = ref('')
const isGameStarted = ref(false)
const chatHistory = ref<ChatMessage[]>([])
const chatMessage = ref('')
const currentRound = ref(1)
const maxRounds = ref(10)
const timeLeft = ref(90)
const guessedPlayers = ref<GuessedPlayer[]>([])
const isGameFinished = ref(false)
const isRoomOwner = ref(false)
const isRoomLocked = ref(false)
const roomOwnerId = ref('')

// 画布相关
const canvas = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)
const isDrawing = ref(false)
const selectedColor = ref('#000000')
const colors = ['#000000', '#ff3b30', '#ff9500', '#ffcc00', '#4cd964', '#5ac8fa', '#007aff', '#5856d6']

// 画笔增强
const brushSize = ref(3)          // 画笔粗细 1-10
const eraserMode = ref(false)     // 擦除模式
let originalColor = '#000000'     // 保存退出擦除前的颜色
const canUndo = ref(false)        // 是否可撤销
const canRedo = ref(false)        // 是否可重做

// 当前画图数据
const drawingData = ref<DrawingData>({
  lines: [],
  clearCount: 0
})

// 计算属性
const isDrawer = computed(() => role.value === 'drawer')
const allPlayersReady = computed(() => {
  return players.value.length >= 2 && players.value.every(p => p.isReady)
})

// 复制房间号
const copyRoomId = async () => {
  if (!roomId.value) return
  try {
    await navigator.clipboard.writeText(roomId.value)
    ElMessage.success(`房间号 ${roomId.value} 已复制到剪贴板，快邀请好友吧！`)
  } catch (err) {
    ElMessage.error('复制失败，请手动复制')
  }
}

const readyCount = computed(() => {
  return players.value.filter(p => p.isReady).length
})

// 获取画布上的实际坐标（考虑缩放）
const getCanvasCoords = (clientX: number, clientY: number) => {
  if (!canvas.value) return null
  const rect = canvas.value.getBoundingClientRect()
  const scaleX = canvas.value.width / rect.width
  const scaleY = canvas.value.height / rect.height
  const x = (clientX - rect.left) * scaleX
  const y = (clientY - rect.top) * scaleY
  // 边界裁剪
  return { 
    x: Math.max(0, Math.min(canvas.value.width, x)), 
    y: Math.max(0, Math.min(canvas.value.height, y)) 
  }
}

// 核心绘图方法：开始绘画
const beginDrawing = (x: number, y: number) => {
  if (!isDrawer.value || !isConnected.value) return
  
  lastX.value = x
  lastY.value = y
  strokeInProgress.value = true
  
  if (socket.value) {
    socket.value.emit('draw', {
      roomId: roomId.value,
      x,
      y,
      type: 'start',
      color: getCurrentColor(),
      lineWidth: brushSize.value
    })
  }
}

// 核心绘图方法：绘画中
const drawing = (x: number, y: number) => {
  if (!isDrawer.value || !isConnected.value || lastX.value === null || lastY.value === null) return
  
  if (!ctx.value) return
  
  ctx.value.strokeStyle = getCurrentColor()
  ctx.value.lineWidth = brushSize.value
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
      color: getCurrentColor(),
      lineWidth: brushSize.value
    })
  }
  
  lastX.value = x
  lastY.value = y
}

// 核心绘图方法：结束绘画
const endDrawing = () => {
  if (isDrawing.value && isDrawer.value && strokeInProgress.value) {
    socket.value?.emit('drawEnd', { roomId: roomId.value })
    strokeInProgress.value = false
  }
  isDrawing.value = false
  lastX.value = null
  lastY.value = null
}

// 鼠标事件
const startDrawing = (e: MouseEvent) => {
  if (!isDrawer.value) return
  e.preventDefault()
  const coords = getCanvasCoords(e.clientX, e.clientY)
  if (coords) {
    isDrawing.value = true
    beginDrawing(coords.x, coords.y)
  }
}

const draw = (e: MouseEvent) => {
  if (!isDrawing.value) return
  e.preventDefault()
  const coords = getCanvasCoords(e.clientX, e.clientY)
  if (coords) {
    drawing(coords.x, coords.y)
  }
}

const stopDrawing = () => {
  endDrawing()
}

// 触摸事件（移动端）
const onTouchStart = (e: TouchEvent) => {
  if (!isDrawer.value) return
  e.preventDefault()
  const touch = e.touches[0]
  const coords = getCanvasCoords(touch.clientX, touch.clientY)
  if (coords) {
    isDrawing.value = true
    beginDrawing(coords.x, coords.y)
  }
}

const onTouchMove = (e: TouchEvent) => {
  if (!isDrawing.value) return
  e.preventDefault()
  const touch = e.touches[0]
  const coords = getCanvasCoords(touch.clientX, touch.clientY)
  if (coords) {
    drawing(coords.x, coords.y)
  }
}

const onTouchEnd = (e: TouchEvent) => {
  e.preventDefault()
  endDrawing()
}

// 获取当前实际使用的颜色（考虑橡皮擦模式）
const getCurrentColor = () => {
  if (eraserMode.value) return '#FFFFFF'
  return selectedColor.value
}

// 清空画布
const clearCanvas = (emitEvent = true) => {
  if (!ctx.value || !canvas.value) return
  ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
  if (emitEvent && socket.value && isDrawer.value) {
    socket.value?.emit('drawClear', { roomId: roomId.value })
  }
}

// 选择颜色，退出橡皮擦模式
const selectColor = (color: string) => {
  eraserMode.value = false
  selectedColor.value = color
}

// 切换橡皮擦模式
const toggleEraser = () => {
  if (!isDrawer.value) return
  if (eraserMode.value) {
    // 退出擦除，恢复原色
    eraserMode.value = false
    selectedColor.value = originalColor
  } else {
    // 进入擦除，保存当前颜色
    originalColor = selectedColor.value
    eraserMode.value = true
  }
}

// 粗细变化
const handleBrushSizeChange = (value: number) => {
  if (ctx.value) ctx.value.lineWidth = value
}

// 撤销
const undo = () => {
  if (!isDrawer.value || !socket.value) return
  socket.value?.emit('undo', { roomId: roomId.value })
}

// 重做
const redo = () => {
  if (!isDrawer.value || !socket.value) return
  socket.value?.emit('redo', { roomId: roomId.value })
}

// 更新撤销/重做按钮状态（根据后端返回的可用性）
const updateUndoRedoStatus = (data: any) => {
  // 从不同类型的数据中提取撤销/重做状态
  if ('canUndo' in data) {
    canUndo.value = data.canUndo || false
  }
  if ('canRedo' in data) {
    canRedo.value = data.canRedo || false
  }
}

// 重新绘制画布（全量）
const redrawCanvas = (data: DrawingData) => {
  if (!ctx.value || !canvas.value) return
  ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.value.lineCap = 'round'
  ctx.value.lineJoin = 'round'
  
  data.lines.forEach((line: DrawingLine) => {
    if (line.points && line.points.length > 0 && ctx.value) {
      ctx.value.strokeStyle = line.color || '#000000'
      ctx.value.lineWidth = line.lineWidth || 3
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
  if (!socket.value) return
  
  const sanitizedMessage = sanitizeInput(chatMessage.value)
  const messageValidation = validateChatMessage(sanitizedMessage)
  
  if (!messageValidation.valid) {
    ElMessage.error(messageValidation.message || '消息验证失败')
    return
  }

  if (!sanitizedMessage.trim()) {
    ElMessage.error('消息不能为空')
    return
  }

  socket.value?.emit('chatMessage', {
    roomId: roomId.value,
    message: sanitizedMessage,
    username: username.value
  })
  chatMessage.value = ''
}

// 加入房间
const joinRoom = () => {
  // 清理输入
  const sanitizedUsername = sanitizeInput(username.value)
  const sanitizedRoomId = sanitizeInput(inputRoomId.value)
  const sanitizedPassword = roomPassword.value ? sanitizeInput(roomPassword.value) : ''

  // 验证用户名
  const usernameValidation = validateUsername(sanitizedUsername)
  if (!usernameValidation.valid) {
    ElMessage.error(usernameValidation.message || '用户名验证失败')
    return
  }

  // 验证房间号
  const roomIdValidation = validateRoomId(sanitizedRoomId)
  if (!roomIdValidation.valid) {
    ElMessage.error(roomIdValidation.message || '房间号验证失败')
    return
  }

  // 验证密码（可选）
  const passwordValidation = validateRoomPassword(sanitizedPassword)
  if (!passwordValidation.valid) {
    ElMessage.error(passwordValidation.message || '密码验证失败')
    return
  }

  socket.value = io('http://localhost:3002')
  
  socket.value.on('connect', () => {
    isConnected.value = true
    socket.value?.emit('joinRoom', sanitizedRoomId, sanitizedUsername, sanitizedPassword)
    roomId.value = sanitizedRoomId
  })

  // 监听加入失败（密码错误等）
  socket.value.on('joinError', (data: ServerJoinError) => {
    ElMessage.error(data.message)
    // 断开连接，让用户重新尝试
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
      isConnected.value = false
    }
  })

  // 监听服务器事件
  socket.value.on('roomInfo', (data: ServerRoomInfo) => {
    showJoinDialog.value = false
    players.value = data.players
    isRoomOwner.value = (socket.value?.id === data.ownerId)
    isRoomLocked.value = data.isLocked
    role.value = data.players.find(p => p.id === socket.value?.id)?.role || ''
    // currentWord is initialized to empty string, no word in room info
    chatHistory.value = data.chatHistory
    drawingData.value = data.drawingData
    currentRound.value = data.currentRound || 1
    maxRounds.value = data.maxRounds || 10
    timeLeft.value = data.timeLeft || 90
    roomOwnerId.value = data.ownerId
    redrawCanvas(data.drawingData)
    // 重置撤销重做状态（由后端历史状态控制）
    updateUndoRedoStatus(data)
  })

  // 监听房间锁定状态变化
  socket.value.on('roomLocked', (data: ServerEvents['roomLocked']) => {
    isRoomLocked.value = data.isLocked
    ElMessage.info(data.isLocked ? '房间已锁定，新玩家无法加入' : '房间已解锁')
  })

  // 监听房间状态更新（玩家列表、房主等）
  socket.value.on('roomStateUpdate', (data: ServerEvents['roomStateUpdate']) => {
    players.value = data.players
    isRoomOwner.value = (socket.value?.id === data.ownerId)
    isRoomLocked.value = data.isLocked
    roomOwnerId.value = data.ownerId
  })

  // 监听被踢出
  socket.value.on('kicked', (data: ServerEvents['kicked']) => {
    ElMessage.error(data.message)
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
    isConnected.value = false
    roomId.value = ''
    showJoinDialog.value = true
    players.value = []
    chatHistory.value = []
    isGameStarted.value = false
    roomOwnerId.value = data.ownerId
  })

  socket.value.on('roomFull', (data: ServerEvents['roomFull']) => {
    ElMessage.error(`房间已满，最多支持${data.maxPlayers}人同时游戏`)
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
      isConnected.value = false
    }
  })

  socket.value.on('playerJoined', (data: ServerEvents['playerJoined']) => {
    players.value = data.players
    roomOwnerId.value = data.ownerId
  })

  socket.value.on('playerLeft', (data: ServerEvents['playerLeft']) => {
    players.value = data.players
    roomOwnerId.value = data.ownerId
  })

  socket.value.on('playerListUpdate', (data: ServerEvents['playerListUpdate']) => {
    players.value = data.players
  })

  // 全量画布更新（用于撤销/重做/同步）
  socket.value.on('canvasUpdate', (data: ServerEvents['canvasUpdate']) => {
    drawingData.value = data.drawingData
    redrawCanvas(data.drawingData)
    updateUndoRedoStatus(data)
  })

  socket.value.on('chatMessage', (msg: ServerEvents['chatMessage']) => {
    chatHistory.value.push(msg)
    scrollChatToBottom()
  })

  socket.value.on('chatError', (data: ServerEvents['chatError']) => {
    ElMessage.error(data.message)
  })

  socket.value.on('gameError', (data: ServerEvents['gameError']) => {
    ElMessage.error(data.message)
  })

  socket.value.on('gameStarted', (data: ServerEvents['gameStarted']) => {
    isGameStarted.value = true
    isGameFinished.value = false
    players.value = data.players
    role.value = data.players.find(p => p.id === socket.value?.id)?.role || ''
    currentWord.value = role.value === 'drawer' ? data.word : ''
    currentRound.value = data.currentRound
    maxRounds.value = data.maxRounds
    timeLeft.value = data.timeLeft
    guessedPlayers.value = []
    isRoomOwner.value = (socket.value?.id === data.ownerId)
    isRoomLocked.value = data.isLocked
    updateUndoRedoStatus(data)
  })

  socket.value.on('newRound', (data: ServerEvents['newRound']) => {
    players.value = data.players
    role.value = data.players.find(p => p.id === socket.value?.id)?.role || ''
    currentWord.value = role.value === 'drawer' ? data.word : ''
    drawingData.value = data.drawingData
    currentRound.value = data.currentRound
    timeLeft.value = data.timeLeft
    guessedPlayers.value = []
    roomOwnerId.value = data.ownerId
    clearCanvas(false)
    redrawCanvas(data.drawingData)
    updateUndoRedoStatus(data)
  })

  socket.value.on('timerUpdate', (data: ServerEvents['timerUpdate']) => {
    timeLeft.value = data.timeLeft
  })

  socket.value.on('scoreUpdate', (data: ServerEvents['scoreUpdate']) => {
    players.value = data.players
    guessedPlayers.value = data.guessedPlayers
  })

  socket.value.on('roundEnded', (data: ServerEvents['roundEnded']) => {
    const guessedNames = data.guessedPlayers.map(g => g.username).join(', ')
    const message = `第${data.currentRound}轮结束！词语是: ${data.word}\n猜对玩家: ${guessedNames || '无'}`
    ElMessage({
      message,
      type: 'info',
      duration: 5000
    })
    players.value = data.players
    guessedPlayers.value = []
  })

  socket.value.on('gameEnded', (data: ServerEvents['gameEnded']) => {
    isGameStarted.value = false
    isGameFinished.value = true
    const winners = data.winners.map(w => w.username).join(', ')
    const scores = data.finalScores.map(s => `${s.username}: ${s.score}分`).join('\n')
    const message = `游戏结束！\n\n获胜者: ${winners}\n\n最终得分:\n${scores}`
    ElMessage({
      message,
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

  socket.value.on('gameReset', (data: ServerEvents['gameReset']) => {
    players.value = data.players;
    roomId.value = data.roomId;
    currentRound.value = data.currentRound;
    maxRounds.value = data.maxRounds;
    timeLeft.value = data.timeLeft;
    chatHistory.value = data.chatHistory;
    drawingData.value = data.drawingData;
    
    isGameStarted.value = false;
    isGameFinished.value = false;
    role.value = '';
    currentWord.value = '';
    guessedPlayers.value = [];
    roomOwnerId.value = data.ownerId

    clearCanvas(false);
    redrawCanvas(data.drawingData);
    scrollChatToBottom();
    updateUndoRedoStatus(data);
  });
}

// 切换准备状态
const toggleReady = () => {
  if (socket.value && !isGameStarted.value) {
    socket.value.emit('toggleReady', roomId.value)
  }
}

// 房主锁定/解锁房间
const toggleRoomLock = () => {
  if (!isRoomOwner.value || !socket.value) return
  socket.value?.emit('lockRoom', {
    roomId: roomId.value,
    lock: !isRoomLocked.value
  })
}

// 房主踢出玩家
const kickPlayer = (targetPlayerId: string, targetUsername: string) => {
  if (!isRoomOwner.value) return
  ElMessageBox.confirm(`确定要踢出玩家 ${targetUsername} 吗？`, '确认踢出', {
    confirmButtonText: '确认',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    socket.value?.emit('kickPlayer', {
      roomId: roomId.value,
      targetPlayerId: targetPlayerId
    })
  }).catch(() => {})
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

// 画布初始化
onMounted(() => {
  if (!canvas.value) return
  ctx.value = canvas.value.getContext('2d')
  if (!ctx.value) return
  ctx.value.lineWidth = brushSize.value
  ctx.value.lineCap = 'round'
  ctx.value.lineJoin = 'round'
})

// 最后位置记录及笔画标记
const lastX = ref<number | null>(null)
const lastY = ref<number | null>(null)
const strokeInProgress = ref(false)

// 清理
onUnmounted(() => {
  if (socket.value) {
    socket.value.disconnect()
  }
})
</script>

<style scoped>
/* 原有样式保持不变，添加移动端适配 */
.room-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.canvas-controls {
  background: #2c3e50;
  padding: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.tool-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.brush-control {
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.2);
  padding: 4px 12px;
  border-radius: 20px;
}

.brush-label {
  color: white;
  font-size: 0.85rem;
  margin-right: 8px;
}

.eraser-btn, .undo-btn, .redo-btn {
  transition: all 0.2s;
}

.color-picker {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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

/* 基础样式 */
.game-container {
  max-width: 80vw;
  margin: 0 auto;
  height: calc(100vh - 50px);
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
  flex-wrap: wrap;
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

.timer.warning {
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
  flex-wrap: nowrap;
  overflow: auto;
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
  background: #ffffff;
  width: 100%;
  height: auto;
  touch-action: none; /* 提升触摸绘图性能 */
}

.game-info-card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(5px);
  border-radius: 15px;
  border: none;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
  overflow-y: auto;
  max-height: 100%;
}

.chat-card {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(5px);
  border-radius: 15px;
  border: none;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  height: calc(100% - 50px);
  overflow-y: auto;
  margin-bottom: 15px;
  padding-right: 10px;
}

.chat-message {
  word-wrap: break-word;
  word-break: break-all;
  white-space: normal;
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

/* ========== 移动端适配样式 ========== */
@media (max-width: 768px) {
  .game-container {
    max-width: 100vw;
    padding: 0 10px;
    height: 100vh;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
    padding: 15px;
  }

  .header h1 {
    font-size: 1.5rem;
  }

  .room-info {
    width: 100%;
    justify-content: space-between;
    gap: 10px;
  }

  .room-badge {
    flex-wrap: wrap;
  }

  .lock-btn {
    margin-left: 0;
  }

  .game-stats {
    margin-left: 0;
    gap: 10px;
  }

  .game-content {
    flex-direction: column;
    height: auto;
    gap: 15px;
  }

  .left-panel,
  .right-panel {
    width: 100%;
  }

  .canvas-container {
    min-height: 400px;
  }

  canvas {
    min-height: 300px;
  }

  .canvas-controls {
    flex-direction: column;
    align-items: stretch;
    padding: 12px;
  }

  .tool-buttons {
    justify-content: center;
  }

  .brush-control {
    justify-content: space-between;
  }

  .color-picker {
    justify-content: center;
  }

  .color-picker div {
    width: 36px;
    height: 36px;
  }

  .right-panel {
    min-width: auto;
  }

  .game-info-card,
  .chat-card {
    max-height: 400px;
  }

  .players-table {
    overflow-x: auto;
    display: block;
  }

  .chat-messages {
    max-height: 200px;
  }

  .chat-input {
    flex-wrap: wrap;
  }

  .chat-input .el-input {
    flex: 1;
  }

  .chat-input .el-button {
    flex-shrink: 0;
  }

  .join-dialog {
    width: 90% !important;
  }
}

/* 小屏幕手机适配 */
@media (max-width: 480px) {
  .header {
    padding: 12px;
  }

  .room-info {
    font-size: 0.9rem;
  }

  .canvas-container {
    min-height: 300px;
  }

  canvas {
    min-height: 250px;
  }

  .tool-buttons .el-button {
    padding: 8px 12px;
    font-size: 12px;
  }

  .brush-control {
    padding: 4px 8px;
  }

  .brush-label {
    font-size: 0.75rem;
  }

  .color-picker div {
    width: 32px;
    height: 32px;
  }

  .game-info-card,
  .chat-card {
    max-height: 350px;
  }

  .role-info h3 {
    font-size: 1rem;
  }

  .word {
    font-size: 0.9rem;
    padding: 4px 10px;
  }

  .players-list h3 {
    font-size: 1rem;
  }
}

/* 横屏模式适配 */
@media (max-width: 1024px) and (orientation: landscape) {
  .game-content {
    flex-direction: row;
  }

  .left-panel {
    flex: 2;
  }

  .right-panel {
    flex: 1;
    min-width: 280px;
  }

  .canvas-container {
    min-height: 60vh;
  }

  canvas {
    min-height: 50vh;
  }
}
</style>