/**
 * lib/urlSafe.js —— 对外可见 URL 的 scheme 安全校验
 * ---------------------------------------------------------------------------
 * 适用场景:任何会被渲染成 <a href={...}> 或 <img src={...}> 的用户 / 管理员
 * 可控 URL 字段(OAuth 客户端的 homepageUrl / logoUrl、卡片外链等)。
 *
 * 为什么要单独抽一层:
 *   • React 确实对 textContent 做自动转义,但 href / src 是**不过**这层转义的
 *     —— 只要 URL scheme 是 javascript: / data: / vbscript: 等,就能执行脚本。
 *   • 单个路由里写正则很容易漏(比如忘了 vbscript: 或忘了 URL 编码的 javas
 *     %63ript: ),集中在这里做一次 `new URL(...).protocol` 判定,由 URL 解析器
 *     统一处理各种畸形输入。
 *
 * 设计原则:
 *   1) 默认拒绝,显式放行 —— 只允许 http: / https:,其他一律拒。
 *   2) 空串和未定义视为"未设置",返回 null(不是错误)。调用方按需决定空
 *      串是合法的"未填"还是必填字段。
 *   3) 不做 SSRF 判断 —— 这是前端 link 的安全性,不是后端 fetch 目标校验。
 *      SSRF 走 lib/ssrfGuard.js。
 * ---------------------------------------------------------------------------
 */

/**
 * 判断给定字符串是不是一个"可以放到 <a href={...}> 的安全 URL"。
 *
 * 合法:
 *   • http://...
 *   • https://...
 *
 * 不合法:
 *   • javascript:...  (含混淆形式如 " javascript: "、"JAVASCRIPT:"、"java\tscript:")
 *   • data:text/html,... (可执行 HTML)
 *   • vbscript:...
 *   • file:...
 *   • blob:...、chrome:...、ftp:... 等其他 scheme
 *   • 空字符串 / 非字符串
 *   • 相对路径(/foo、foo/bar):调用方如需允许,自行判断 startsWith('/')
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isSafeHttpUrl(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s) return false;
  // URL 构造函数会容忍前导/后缀 whitespace,但不会容忍内嵌的控制字符。
  // 这里显式拒掉任何控制字符(0x00–0x1F、0x7F),防止如 "java\nscript:"
  // 被某些浏览器宽松解析为 javascript:。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(s)) return false;
  let u;
  try { u = new URL(s); }
  catch { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/**
 * 把用户提交的 URL 规范化为"安全可展示"形式:
 *   • 合法 http(s) → 返回 trim 后的字符串
 *   • 空 / 非法 → 返回空字符串("未设置")
 *
 * 用于 OAuth 客户端的 homepageUrl / logoUrl 这类"可选的展示字段":即使填的是
 * javascript:... 也不该写入 DB —— 悄悄换成空串比报错提示更稳,前端自然回落
 * 到 "未提供链接" 的展示。
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeHttpUrlOrEmpty(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return isSafeHttpUrl(trimmed) ? trimmed : '';
}

/**
 * 扩展版:允许"站内相对路径"(以 '/' 开头且不是 '//...' 开头的协议相对 URL)。
 * 用于卡片 card.url —— 业务上允许 `/admin` 这类站内链接。
 *
 * 合法:
 *   • /some/path
 *   • /foo?a=1
 *   • http(s)://...
 *
 * 不合法:
 *   • //attacker.com   (protocol-relative,浏览器会跟当前协议拼,可跳到外站)
 *   • javascript:...   同上
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isSafeCardUrl(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(s)) return false;
  // 站内相对路径:必须以 '/' 开头,且第二个字符不是 '/'(否则是 protocol-relative)
  if (s.startsWith('/')) {
    if (s.length >= 2 && s[1] === '/') return false;
    // 站内路径不允许出现 \(反斜杠),某些浏览器会把它和 / 同义处理,导致
    // /\\attacker.com 这类绕过;这里直接拒。
    if (s.includes('\\')) return false;
    return true;
  }
  return isSafeHttpUrl(s);
}
