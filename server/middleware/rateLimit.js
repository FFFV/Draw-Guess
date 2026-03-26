/**
 * Socket.io 速率限制中间件
 */

class RateLimiter {
  constructor() {
    // 存储每个Socket的请求计数
    this.requests = new Map();
    // 存储每个Socket的请求时间戳
    this.timestamps = new Map();
    // 清理过期数据的定时器
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // 每5分钟清理一次
  }

  /**
   * 检查是否超过速率限制
   * @param {string} socketId Socket ID
   * @param {string} eventType 事件类型
   * @param {Object} limits 限制配置 {windowMs, maxRequests}
   * @returns {Object} 检查结果 {allowed: boolean, remaining: number, resetTime: number}
   */
  check(socketId, eventType, limits) {
    const now = Date.now();
    const key = `${socketId}:${eventType}`;
    
    // 初始化或清理过期数据
    if (!this.requests.has(key) || !this.timestamps.has(key)) {
      this.requests.set(key, 0);
      this.timestamps.set(key, now);
    }
    
    const firstRequestTime = this.timestamps.get(key);
    const requestCount = this.requests.get(key);
    
    // 检查时间窗口是否过期
    if (now - firstRequestTime > limits.windowMs) {
      // 重置计数器
      this.requests.set(key, 1);
      this.timestamps.set(key, now);
      return {
        allowed: true,
        remaining: limits.maxRequests - 1,
        resetTime: now + limits.windowMs
      };
    }
    
    // 检查是否超过限制
    if (requestCount >= limits.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: firstRequestTime + limits.windowMs
      };
    }
    
    // 增加计数器
    this.requests.set(key, requestCount + 1);
    return {
      allowed: true,
      remaining: limits.maxRequests - (requestCount + 1),
      resetTime: firstRequestTime + limits.windowMs
    };
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    const now = Date.now();
    const expirationTime = 10 * 60 * 1000; // 10分钟无活动则清理
    
    for (const [key, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > expirationTime) {
        this.requests.delete(key);
        this.timestamps.delete(key);
      }
    }
  }

  /**
   * 停止清理定时器
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// 不同事件类型的速率限制配置
const EVENT_LIMITS = {
  // 聊天消息：每分钟最多30条
  chatMessage: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 30
  },
  // 绘图事件：每秒最多50个点
  draw: {
    windowMs: 1000, // 1秒
    maxRequests: 50
  },
  // 准备状态切换：每分钟最多20次
  toggleReady: {
    windowMs: 60 * 1000,
    maxRequests: 20
  },
  // 房间操作（锁定/踢出）：每分钟最多10次
  lockRoom: {
    windowMs: 60 * 1000,
    maxRequests: 10
  },
  kickPlayer: {
    windowMs: 60 * 1000,
    maxRequests: 10
  },
  // 默认限制：每分钟最多100个事件
  default: {
    windowMs: 60 * 1000,
    maxRequests: 100
  }
};

const rateLimiter = new RateLimiter();

/**
 * Socket.io 速率限制中间件
 * @param {Object} socket Socket.io socket对象
 * @param {string} eventName 事件名称
 * @param {Function} next 下一步函数
 * @param {Object} data 事件数据
 */
function rateLimitMiddleware(socket, eventName, next, data) {
  // 获取该事件的限制配置
  const limits = EVENT_LIMITS[eventName] || EVENT_LIMITS.default;
  
  // 检查速率限制
  const result = rateLimiter.check(socket.id, eventName, limits);
  
  if (!result.allowed) {
    // 发送速率限制错误
    socket.emit('rateLimitError', {
      message: `请求过于频繁，请 ${Math.ceil((result.resetTime - Date.now()) / 1000)} 秒后再试`,
      resetTime: result.resetTime
    });
    return;
  }
  
  // 添加剩余次数到数据中（可选）
  if (data && typeof data === 'object') {
    data._rateLimit = {
      remaining: result.remaining,
      resetTime: result.resetTime
    };
  }
  
  // 继续处理
  next(data);
}

/**
 * 创建速率限制包装器
 * @param {Object} io Socket.io实例
 */
function setupRateLimit(io) {
  // 监听连接，为每个socket添加中间件
  io.on('connection', (socket) => {
    // 为特定事件添加速率限制
    const eventsToLimit = Object.keys(EVENT_LIMITS);
    
    eventsToLimit.forEach(eventName => {
      // 保存原始监听器
      const originalListeners = socket.listeners(eventName);
      
      // 移除原始监听器
      socket.removeAllListeners(eventName);
      
      // 添加带速率限制的新监听器
      socket.on(eventName, (data) => {
        rateLimitMiddleware(socket, eventName, (processedData) => {
          // 调用原始监听器
          originalListeners.forEach(listener => {
            listener.call(socket, processedData);
          });
        }, data);
      });
    });
  });
}

/**
 * 停止速率限制器
 */
function stopRateLimiter() {
  rateLimiter.stop();
}

module.exports = {
  rateLimitMiddleware,
  setupRateLimit,
  stopRateLimiter,
  EVENT_LIMITS
};