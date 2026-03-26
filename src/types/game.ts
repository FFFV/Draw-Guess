// 玩家相关类型
export interface Player {
  id: string;
  username: string;
  role: 'drawer' | 'guesser';
  score: number;
  isReady: boolean;
}

export interface ChatMessage {
  id: number;
  username: string;
  message: string;
  timestamp: string;
  isSystem: boolean;
  correctGuess?: boolean;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingLine {
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
}

export interface DrawingData {
  lines: DrawingLine[];
  clearCount: number;
}

export interface GuessedPlayer {
  playerId: string;
  username: string;
  scoreAdded: number;
  guessMessage: string;
  timestamp: number;
}

// 游戏状态类型
export interface GameState {
  roomId: string;
  players: Player[];
  role: Player['role'];
  currentWord: string;
  isGameStarted: boolean;
  chatHistory: ChatMessage[];
  chatMessage: string;
  currentRound: number;
  maxRounds: number;
  timeLeft: number;
  guessedPlayers: GuessedPlayer[];
  isGameFinished: boolean;
  isRoomOwner: boolean;
  isRoomLocked: boolean;
  roomOwnerId: string;
}

// Socket事件数据类型
export interface SocketJoinData {
  roomId: string;
  username: string;
  password?: string;
}

export interface SocketDrawData {
  roomId: string;
  x: number;
  y: number;
  type: 'start' | 'move';
  color: string;
  lineWidth: number;
}

export interface SocketDrawEndData {
  roomId: string;
}

export interface SocketDrawClearData {
  roomId: string;
}

export interface SocketUndoRedoData {
  roomId: string;
}

export interface SocketChatData {
  roomId: string;
  message: string;
  username: string;
}

export interface SocketKickData {
  roomId: string;
  targetPlayerId: string;
}

export interface SocketLockRoomData {
  roomId: string;
  lock: boolean;
}

// 服务器响应类型
export interface ServerRoomInfo {
  roomId: string;
  players: Player[];
  ownerId: string;
  isLocked: boolean;
  currentRound: number;
  maxRounds: number;
  timeLeft: number;
  state: string;
  chatHistory: ChatMessage[];
  drawingData: DrawingData;
}

export interface ServerJoinError {
  message: string;
}

export interface ServerGameError {
  message: string;
}

export interface ServerChatError {
  message: string;
}