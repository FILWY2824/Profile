/**
 * lib/username.js —— 用户名校验的单一数据源
 * ---------------------------------------------------------------------------
 * 之前用户名长度限制散落在 register / profile / admin users 三处,上一次要从
 * "2-32" 收紧到 "2-10" 还得改三个文件,极易漏改。从现在起所有需要校验用户
 * 名的地方都走 validateName(),确保修改只改一处。
 *
 * 限制:
 *   • 长度 2–10 字符(去掉首尾空白后的可见长度;10 这个上限是产品约束,
 *     不是技术约束,改动请对齐前端 maxLength 与 DB 列宽如果有的话)
 *   • 不允许全空白 / 纯空字符串
 *   • 其它字符(中英文、数字、emoji、下划线等)都放行,不做白名单 ——
 *     如果将来要禁止特殊符号或 emoji,加到这里,别在各 route 里散装正则
 * ---------------------------------------------------------------------------
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 10;

/**
 * @param {unknown} raw  客户端传来的值,可能是 undefined / 非字符串
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateName(raw) {
  if (raw == null || typeof raw !== 'string') {
    return { valid: false, message: '用户名不能为空' };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { valid: false, message: '用户名不能为空' };
  }
  if (value.length < NAME_MIN_LENGTH) {
    return { valid: false, message: `用户名长度至少 ${NAME_MIN_LENGTH} 个字符` };
  }
  // 用户可能输入 emoji 或其它多字节字符。JS 字符串的 .length 走 UTF-16
  // code units,emoji 通常算 2。我们这里按 code units 判,更贴近前端 input
  // 的 maxLength 行为(浏览器也是按 UTF-16 计数),体验一致。
  if (value.length > NAME_MAX_LENGTH) {
    return { valid: false, message: `用户名长度不能超过 ${NAME_MAX_LENGTH} 个字符` };
  }
  return { valid: true, value };
}
