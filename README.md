# 多人你画我猜游戏

一个基于 Vue3 + Vite + Socket.io 的多人实时联机你画我猜网页游戏。

## 功能特性

✅ **多人实时联机** - 同一局域网下多人打开网页即可同步画画、聊天  
✅ **角色系统** - 自动/手动切换 画画者、猜词者  
✅ **绘图功能** - Canvas鼠标画画，画笔粗细固定，支持清空画布  
✅ **实时同步** - 画画轨迹、清空画布、聊天消息全员实时同步  
✅ **猜词系统** - 内置随机词库（苹果、小猫、太阳、汽车等），画画者可见题目  
✅ **聊天交互** - 输入框发消息，猜对单词自动提示猜对了  
✅ **得分系统** - 猜对者得10分，画图者得5分  
✅ **响应式设计** - 适配电脑端，简洁美观的UI  

## 项目结构

```
draw-and-guess/
├── package.json              # 前端依赖
├── vite.config.js            # Vite配置
├── index.html               # HTML入口
├── src/
│   ├── main.js              # Vue应用入口
│   └── App.vue              # 主组件
├── server/
│   ├── package.json         # 后端依赖
│   └── server.js            # Socket.io服务器
└── README.md                # 项目说明
```

## 快速开始

### 1. 安装依赖

#### 前端依赖
```bash
npm install
# 或使用 yarn
yarn install
```

#### 后端依赖
```bash
cd server
npm install
cd ..
```

### 2. 启动服务器

#### 启动后端 Socket.io 服务器
```bash
cd server
npm start
# 服务器将在 http://localhost:3001 启动
```

#### 启动前端开发服务器（新终端窗口）
```bash
npm run dev
# 前端将在 http://localhost:3000 启动
```

### 3. 开始游戏

1. 打开浏览器访问：`http://localhost:3000`
2. 输入用户名和房间号（默认房间号：`room1`）
3. 邀请朋友们在相同房间号加入游戏
4. 当至少有2位玩家时，点击"开始游戏"
5. 画图者开始画画，其他玩家猜词

## 游戏规则

1. **角色分配**：第一个加入房间的玩家成为画图者，其他玩家为猜词者
2. **画图阶段**：画图者看到随机题目（如"苹果"），在画布上作画
3. **猜词阶段**：其他玩家通过聊天框输入猜测的词语
4. **得分**：猜对者得10分，画图者得5分
5. **轮换**：每轮结束后自动切换画图者

## 技术栈

- **前端**：Vue 3 + Vite + 组合式API `<script setup>`
- **联机通信**：Socket.io-client（前端） + Express + Socket.io（后端）
- **绘图**：HTML5 Canvas
- **样式**：原生CSS + Flexbox + Grid
- **构建工具**：Vite

## API 接口

### Socket.io 事件

| 事件 | 方向 | 数据 | 描述 |
|------|------|------|------|
| `joinRoom` | 客户端→服务端 | `{ roomId, username }` | 加入房间 |
| `roomInfo` | 服务端→客户端 | 房间信息 | 返回房间状态 |
| `draw` | 客户端→服务端 | `{ roomId, x, y, type, color }` | 绘制事件 |
| `drawingUpdate` | 服务端→客户端 | 绘制数据 | 同步绘图数据 |
| `chatMessage` | 双向 | `{ roomId, message, username }` | 发送/接收聊天消息 |
| `startGame` | 客户端→服务端 | `roomId` | 开始游戏 |
| `switchDrawer` | 客户端→服务端 | `roomId` | 切换画图者 |
| `playerJoined` | 服务端→客户端 | 玩家信息 | 新玩家加入通知 |
| `playerLeft` | 服务端→客户端 | 玩家信息 | 玩家离开通知 |

## 词库

游戏内置以下词语：
- 苹果、小猫、太阳、汽车、房子、大树、飞机、电脑
- 手机、书本、椅子、桌子、香蕉、西瓜、老虎、大象
- 月亮、星星、雨伞、篮球、足球、帽子、鞋子、衣服

## 开发说明

### 前端开发
```bash
npm run dev    # 开发模式
npm run build  # 生产构建
npm run preview # 预览生产构建
```

### 后端开发
```bash
cd server
node server.js
```

### 跨域配置
后端已配置 CORS，允许 `http://localhost:3000` 访问。

## 常见问题

### Q: 画图不同步
A: 确保所有玩家都在同一个房间，且网络连接正常。

### Q: 无法加入房间
A: 确保后端服务器已启动（端口3001），前端已连接。

### Q: 多人同时画图
A: 只有画图者角色可以画图，其他玩家为猜词者。

### Q: 如何修改词库
A: 编辑 `server/server.js` 中的 `WORDS` 数组。

## 部署建议

### 前端部署
1. 构建生产版本：`npm run build`
2. 部署 `dist` 文件夹到静态服务器（如Nginx、Vercel、Netlify）

### 后端部署
1. 安装PM2：`npm install -g pm2`
2. 启动服务：`pm2 start server.js`
3. 设置反向代理（如Nginx）

### Docker 部署
```dockerfile
# Dockerfile 示例
FROM node:18-alpine

# 前端构建
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 后端
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ .

# 启动
EXPOSE 3000 3001
CMD ["sh", "-c", "cd /app && npm run build && cd /app/server && npm start"]
```