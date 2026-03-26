import type { Player, ChatMessage, DrawingData, GuessedPlayer, ServerRoomInfo } from './game'

/**
 * Socket.io 服务器事件类型定义
 * 这些是服务器发送给客户端的事件
 */
export interface ServerEvents {
  // 连接相关事件
  'connect': () => void
  'disconnect': () => void
  
  // 房间相关事件
  'joinError': { message: string }
  'roomFull': { maxPlayers: number }
  'roomInfo': ServerRoomInfo
  'roomLocked': { isLocked: boolean }
  'roomStateUpdate': { 
    players: Player[]
    ownerId: string
    isLocked: boolean
  }
  'playerJoined': {
    player: Player
    players: Player[]
    ownerId: string
    isLocked: boolean
  }
  'playerLeft': {
    players: Player[]
    ownerId: string
  }
  'playerListUpdate': {
    players: Player[]
  }
  'kicked': {
    message: string
    ownerId: string
  }
  
  // 画布相关事件
  'canvasUpdate': {
    drawingData: DrawingData
    canUndo: boolean
    canRedo: boolean
  }
  
  // 聊天相关事件
  'chatMessage': ChatMessage
  'chatError': { message: string }
  
  // 游戏相关事件
  'gameError': { message: string }
  'gameStarted': {
    players: Player[]
    word: string
    currentRound: number
    maxRounds: number
    timeLeft: number
    ownerId: string
    isLocked: boolean
  }
  'newRound': {
    players: Player[]
    word: string
    drawingData: DrawingData
    currentRound: number
    maxRounds: number
    timeLeft: number
    ownerId: string
    isLocked: boolean
  }
  'timerUpdate': { timeLeft: number }
  'scoreUpdate': {
    players: Player[]
    guessedPlayers: GuessedPlayer[]
  }
  'roundEnded': {
    word: string
    guessedPlayers: GuessedPlayer[]
    players: Player[]
    currentRound: number
    maxRounds: number
  }
  'gameEnded': {
    players: Player[]
    winners: Player[]
    finalScores: Array<{username: string, score: number}>
    totalRounds: number
    ownerId: string
    isLocked: boolean
  }
  'gameReset': ServerRoomInfo
  
  // 角色更新事件
  'roleUpdate': { players: Player[] }
}

/**
 * Socket.io 客户端事件类型定义
 * 这些是客户端发送给服务器的事件
 */
export interface ClientEvents {
  // 房间相关事件
  'joinRoom': (roomId: string, username: string, password?: string) => void
  'lockRoom': (data: { roomId: string; lock: boolean }) => void
  'kickPlayer': (data: { roomId: string; targetPlayerId: string }) => void
  
  // 游戏控制事件
  'toggleReady': (roomId: string) => void
  'startGame': (roomId: string) => void
  
  // 画布相关事件
  'draw': (data: {
    roomId: string
    x: number
    y: number
    type: 'start' | 'move'
    color: string
    lineWidth: number
  }) => void
  'drawEnd': (data: { roomId: string }) => void
  'drawClear': (data: { roomId: string }) => void
  'undo': (data: { roomId: string }) => void
  'redo': (data: { roomId: string }) => void
  
  // 聊天相关事件
  'chatMessage': (data: {
    roomId: string
    message: string
    username: string
  }) => void
}

/**
 * 服务器响应数据的通用接口
 */
export interface ServerResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

/**
 * 游戏状态更新数据的通用接口
 */
export interface GameStateUpdate {
  roomId: string
  timestamp: number
  data: any
}