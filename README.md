# 🎨 你画我猜 - 在线多人游戏

一个基于 WebSocket 的实时多人“你画我猜”游戏，支持多房间、实时绘画、聊天猜词、计分系统等功能。玩家可以创建或加入房间，轮流担任画师，其他玩家根据画作猜词，猜对得分。

---

## 📖 目录

- [游戏特性](#-游戏特性)
- [技术栈](#-技术栈)
- [快速开始](#-快速开始)
- [使用说明](#-使用说明)
- [项目结构](#-项目结构)
- [配置说明](#-配置说明)
- [API 事件参考](#-api-事件参考)
- [常见问题](#-常见问题)

---

## 🎮 游戏特性

- **实时绘画**：画师使用画笔/橡皮擦绘画，所有玩家实时同步画作
- **猜词系统**：猜词玩家在聊天框输入词语，猜对即可获得分数
- **回合制**：每位玩家轮流担任画师，每轮限时 90 秒
- **积分排行**：猜对越早得分越高，画师在首个猜对时获得额外加分
- **房间管理**：房主可锁定房间、踢出玩家，支持房间密码保护
- **准备机制**：游戏开始前所有玩家需点击“准备”，满足人数后自动开始
- **绘画辅助**：撤销/重做、清空画布、多色画笔、粗细调节
- **跨设备**：支持 PC 鼠标和移动端触摸绘画
- **自动清理**：空闲房间 30 分钟后自动销毁

---

## 🛠️ 技术栈

### 前端
- [Vue 3](https://vuejs.org/) (Composition API + TypeScript)
- [Socket.io-client](https://socket.io/docs/v4/client-api/)
- [Element Plus](https://element-plus.org/) (UI 组件库)
- HTML5 Canvas

### 后端
- [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/)
- [Socket.io](https://socket.io/)
- 内存数据存储（无数据库）

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 16.0
- npm 或 yarn


### 安装依赖
```bash
# 后端依赖
npm install express socket.io

# 前端依赖（如果使用 Vue CLI 或 Vite 单独构建）
# 项目为单文件结构，需自行配置构建工具
```

### 配置

1. **修改服务器地址**  
   在 `App.vue` 中找到 Socket.IO 连接地址：
   ```js
   socket.value = io('https://your-domain.com')  // 替换为你的后端地址
   ```
   若本地测试可改为 `http://localhost:3002`

2. **修改 CORS 配置**（`server.js`）
   ```js
   const io = new Server(server, {
     cors: {
       origin: "https://your-frontend-domain.com", // 前端域名
       methods: ["GET", "POST"]
     }
   });
   ```

### 启动后端
```bash
node server.js
```
默认监听端口 `3002`，可通过环境变量 `PORT` 修改。

### 启动前端
若使用 Vite：
```bash
npm run dev
```
或直接将 `App.vue` 集成到现有 Vue 项目中。

---

## 📖 使用说明

### 创建/加入房间
1. 打开游戏页面，弹出“加入房间”对话框。
2. 输入用户名、房间号（任意字符串，相同房间号即同一房间）。
3. 可选：输入房间密码（如果房主设置了密码）。
4. 点击“加入房间”。

### 准备游戏
- 房间内至少 2 名玩家后，每位玩家点击“准备”按钮。
- 当所有玩家都准备后，游戏自动开始。

### 房主功能
- **锁定房间**：禁止新玩家加入（游戏开始后自动锁定）。
- **踢出玩家**：在玩家列表中点击“踢出”按钮。

### 绘画（画师）
- 游戏开始后，当前画师会看到词语。
- 使用左侧颜色盘选择画笔颜色，调节粗细。
- 点击“橡皮擦”可擦除（实际为白色画笔）。
- “撤销”/“重做”可回退绘画步骤。
- “清空画布”清除所有内容。

### 猜词（猜词者）
- 在右侧聊天框输入词语（必须与当前词语完全一致，中文匹配）。
- 猜对后聊天记录会高亮显示，并获得分数（第 1 个猜对得 10 分，第 2 个 8 分，依次递减）。
- 画师在第 1 个玩家猜对时获得 3 分奖励。

### 回合与结束
- 每轮限时 90 秒，倒计时结束或所有猜词者猜对后进入下一轮。
- 每位玩家轮流担任一次画师后游戏结束，按总分排名。

---

## 📁 项目结构

```
├── server.js               # 后端主文件
├── middleware/
│   ├── validation.js       # 输入验证中间件
│   └── rateLimit.js        # 速率限制中间件
├── utils/
│   └── validation.ts       # 前端验证工具
├── types/
│   ├── game.ts             # TypeScript 类型定义
│   └── socket-events.ts    # Socket 事件类型
└── App.vue                 # 前端主组件
```

---

## ⚙️ 配置说明

### 游戏规则配置（server.js）
```js
const GAME_CONFIG = {
  MIN_PLAYERS: 2,           // 最少玩家数
  MAX_PLAYERS: 8,           // 最多玩家数
  ROUND_TIME: 90,           // 每轮秒数
  DRAWER_SCORE: 3,          // 画师奖励分
  GUESSER_SCORES: [10,8,6,4,2], // 猜对得分（按顺序递减）
  MAX_HISTORY: 30           // 最大撤销步数
};
```

### 词语库（server.js）
```js
const WORDS = [
  '苹果', '小猫', '太阳', '汽车', '房子', '大树', '飞机', '电脑', 
  '手机', '书本', '椅子', '桌子', '香蕉', '西瓜', '老虎', '大象',
  '月亮', '星星', '雨伞', '篮球', '足球', '帽子', '鞋子', '衣服'
];
```
可自行添加更多词语。

---

## 🔌 API 事件参考

### 客户端 → 服务器

| 事件名 | 数据格式 | 说明 |
|--------|----------|------|
| `joinRoom` | `(roomId, username, password)` | 加入房间 |
| `toggleReady` | `(roomId)` | 切换准备状态 |
| `lockRoom` | `{ roomId, lock }` | 房主锁定/解锁房间 |
| `kickPlayer` | `{ roomId, targetPlayerId }` | 房主踢出玩家 |
| `drawBatch` | `{ roomId, points, color, lineWidth }` | 批量发送绘画点 |
| `drawEnd` | `{ roomId }` | 结束当前笔画 |
| `drawClear` | `{ roomId }` | 清空画布 |
| `undo` | `{ roomId }` | 撤销 |
| `redo` | `{ roomId }` | 重做 |
| `chatMessage` | `{ roomId, message, username }` | 发送聊天/猜词 |
| `startGame` | `(roomId)` | 强制开始游戏（房主） |

### 服务器 → 客户端

| 事件名 | 说明 |
|--------|------|
| `roomInfo` | 返回房间完整信息 |
| `roomStateUpdate` | 玩家列表、房主、锁定状态更新 |
| `playerJoined` | 新玩家加入 |
| `playerLeft` | 玩家离开 |
| `gameStarted` | 游戏开始 |
| `newRound` | 新回合开始 |
| `timerUpdate` | 倒计时更新 |
| `scoreUpdate` | 分数更新 |
| `roundEnded` | 回合结束 |
| `gameEnded` | 游戏结束 |
| `gameReset` | 游戏重置 |
| `canvasUpdate` | 全量画布更新 |
| `drawBatch` | 增量绘画点 |
| `chatMessage` | 新聊天消息 |
| `joinError` / `gameError` | 错误信息 |

---

## 📝 待优化功能（可自行扩展）

- [ ] 词语难度分级与自定义词库
- [ ] 猜词提示（拼音、字数提示）
- [ ] 语音输入猜词
- [ ] 观战模式
- [ ] 历史战绩保存（数据库）
- [ ] 私人房间邀请链接

---

## 📄 开源协议

MIT License © 2026
