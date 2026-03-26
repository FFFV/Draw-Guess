/**
 * Socket.io 事件数据验证中间件
 */

/**
 * 验证 joinRoom 事件数据
 * @param {Object} data 事件数据 {roomId, username, password}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateJoinRoom(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId, username, password } = data;

  // 验证房间号
  if (!roomId || typeof roomId !== 'string' || roomId.trim().length === 0) {
    return { valid: false, message: '房间号不能为空' };
  }

  if (roomId.length > 50) {
    return { valid: false, message: '房间号不能超过50个字符' };
  }

  const roomIdRegex = /^[a-zA-Z0-9_-]+$/;
  if (!roomIdRegex.test(roomId)) {
    return { valid: false, message: '房间号只能包含字母、数字、下划线和短横线' };
  }

  // 验证用户名
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { valid: false, message: '用户名不能为空' };
  }

  if (username.length < 2) {
    return { valid: false, message: '用户名至少需要2个字符' };
  }

  if (username.length > 20) {
    return { valid: false, message: '用户名不能超过20个字符' };
  }

  const usernameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;
  if (!usernameRegex.test(username)) {
    return { valid: false, message: '用户名只能包含中文、英文和数字' };
  }

  // 验证密码（可选）
  if (password && typeof password === 'string') {
    if (password.length > 50) {
      return { valid: false, message: '密码不能超过50个字符' };
    }
  }

  return { valid: true };
}

/**
 * 验证 draw 事件数据
 * @param {Object} data 事件数据 {roomId, x, y, type, color, lineWidth}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateDraw(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId, x, y, type, color, lineWidth } = data;

  // 验证房间号
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, message: '房间号无效' };
  }

  // 验证坐标
  if (typeof x !== 'number' || x < 0 || x > 800) {
    return { valid: false, message: 'X坐标无效' };
  }

  if (typeof y !== 'number' || y < 0 || y > 600) {
    return { valid: false, message: 'Y坐标无效' };
  }

  // 验证绘图类型
  if (!['start', 'move'].includes(type)) {
    return { valid: false, message: '绘图类型无效' };
  }

  // 验证颜色（可选）
  if (color && typeof color === 'string') {
    const colorRegex = /^#[0-9A-F]{6}$/i;
    if (!colorRegex.test(color)) {
      return { valid: false, message: '颜色格式无效' };
    }
  }

  // 验证线宽（可选）
  if (lineWidth && (typeof lineWidth !== 'number' || lineWidth < 1 || lineWidth > 20)) {
    return { valid: false, message: '线宽无效' };
  }

  return { valid: true };
}

/**
 * 验证 chatMessage 事件数据
 * @param {Object} data 事件数据 {roomId, message, username}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateChatMessage(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId, message, username } = data;

  // 验证房间号
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, message: '房间号无效' };
  }

  // 验证用户名
  if (!username || typeof username !== 'string') {
    return { valid: false, message: '用户名无效' };
  }

  // 验证消息
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { valid: false, message: '消息不能为空' };
  }

  if (message.length > 500) {
    return { valid: false, message: '消息不能超过500个字符' };
  }

  // 检查危险字符（防止XSS）
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /onclick/i,
    /onload/i,
    /onerror/i,
    /eval\(/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(message)) {
      return { valid: false, message: '消息包含不安全的内容' };
    }
  }

  return { valid: true };
}

/**
 * 验证 lockRoom 事件数据
 * @param {Object} data 事件数据 {roomId, lock}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateLockRoom(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId, lock } = data;

  // 验证房间号
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, message: '房间号无效' };
  }

  // 验证锁定状态
  if (typeof lock !== 'boolean') {
    return { valid: false, message: '锁定状态无效' };
  }

  return { valid: true };
}

/**
 * 验证 kickPlayer 事件数据
 * @param {Object} data 事件数据 {roomId, targetPlayerId}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateKickPlayer(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId, targetPlayerId } = data;

  // 验证房间号
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, message: '房间号无效' };
  }

  // 验证目标玩家ID
  if (!targetPlayerId || typeof targetPlayerId !== 'string') {
    return { valid: false, message: '目标玩家ID无效' };
  }

  return { valid: true };
}

/**
 * 验证简单事件数据（只需要房间号）
 * @param {Object} data 事件数据 {roomId}
 * @returns {Object} 验证结果 {valid, message}
 */
function validateSimpleEvent(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, message: '无效的数据格式' };
  }

  const { roomId } = data;

  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, message: '房间号无效' };
  }

  return { valid: true };
}

/**
 * 转义HTML特殊字符
 * @param {string} text 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 清理用户输入
 * @param {string} input 用户输入
 * @returns {string} 清理后的输入
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return escapeHtml(input.trim());
}

module.exports = {
  validateJoinRoom,
  validateDraw,
  validateChatMessage,
  validateLockRoom,
  validateKickPlayer,
  validateSimpleEvent,
  escapeHtml,
  sanitizeInput
};