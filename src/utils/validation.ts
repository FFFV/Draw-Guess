import type { SocketDrawData } from '@/types/game'

/**
 * 验证用户名
 * @param username 用户名
 * @returns 验证结果和错误信息
 */
export function validateUsername(username: string): { valid: boolean; message?: string } {
  if (!username || username.trim().length === 0) {
    return { valid: false, message: '用户名不能为空' }
  }

  if (username.length < 2) {
    return { valid: false, message: '用户名至少需要2个字符' }
  }

  if (username.length > 20) {
    return { valid: false, message: '用户名不能超过20个字符' }
  }

  // 允许中文、英文、数字
  const usernameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/
  if (!usernameRegex.test(username)) {
    return { valid: false, message: '用户名只能包含中文、英文和数字' }
  }

  return { valid: true }
}

/**
 * 验证房间号
 * @param roomId 房间号
 * @returns 验证结果和错误信息
 */
export function validateRoomId(roomId: string): { valid: boolean; message?: string } {
  if (!roomId || roomId.trim().length === 0) {
    return { valid: false, message: '房间号不能为空' }
  }

  if (roomId.length < 1) {
    return { valid: false, message: '房间号至少需要1个字符' }
  }

  if (roomId.length > 50) {
    return { valid: false, message: '房间号不能超过50个字符' }
  }

  // 允许字母、数字、下划线、短横线
  const roomIdRegex = /^[a-zA-Z0-9_-]+$/
  if (!roomIdRegex.test(roomId)) {
    return { valid: false, message: '房间号只能包含字母、数字、下划线和短横线' }
  }

  return { valid: true }
}

/**
 * 验证聊天消息
 * @param message 聊天消息
 * @returns 验证结果和错误信息
 */
export function validateChatMessage(message: string): { valid: boolean; message?: string } {
  if (!message || message.trim().length === 0) {
    return { valid: false, message: '消息不能为空' }
  }

  if (message.length > 500) {
    return { valid: false, message: '消息不能超过500个字符' }
  }

  // 检查危险字符（防止XSS）
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /onclick/i,
    /onload/i,
    /onerror/i,
    /eval\(/i
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(message)) {
      return { valid: false, message: '消息包含不安全的内容' }
    }
  }

  return { valid: true }
}

/**
 * 验证绘图数据
 * @param data 绘图数据
 * @returns 验证结果和错误信息
 */
export function validateDrawData(data: Partial<SocketDrawData>): { valid: boolean; message?: string } {
  if (!data) {
    return { valid: false, message: '绘图数据不能为空' }
  }

  // 验证坐标范围（假设画布大小为800x600）
  if (typeof data.x !== 'number' || data.x < 0 || data.x > 800) {
    return { valid: false, message: 'X坐标无效' }
  }

  if (typeof data.y !== 'number' || data.y < 0 || data.y > 600) {
    return { valid: false, message: 'Y坐标无效' }
  }

  // 验证绘图类型
  if (!['start', 'move'].includes(data.type || '')) {
    return { valid: false, message: '绘图类型无效' }
  }

  // 验证颜色格式
  if (data.color && !/^#[0-9A-F]{6}$/i.test(data.color)) {
    return { valid: false, message: '颜色格式无效' }
  }

  // 验证线宽
  if (data.lineWidth && (data.lineWidth < 1 || data.lineWidth > 20)) {
    return { valid: false, message: '线宽无效' }
  }

  return { valid: true }
}

/**
 * 验证房间密码
 * @param password 房间密码
 * @returns 验证结果和错误信息
 */
export function validateRoomPassword(password?: string): { valid: boolean; message?: string } {
  if (!password) {
    // 密码可选
    return { valid: true }
  }

  if (password.length > 50) {
    return { valid: false, message: '密码不能超过50个字符' }
  }

  return { valid: true }
}

/**
 * 转义HTML特殊字符
 * @param text 要转义的文本
 * @returns 转义后的文本
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  
  return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * 清理用户输入
 * @param input 用户输入
 * @returns 清理后的输入
 */
export function sanitizeInput(input: string): string {
  return escapeHtml(input.trim())
}