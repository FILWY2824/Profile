/**
 * lib/settingsValidation.js —— 受管配置项的值校验(#7 修复)
 * ---------------------------------------------------------------------------
 * 历史问题:
 *   /api/admin/settings PATCH 只挡了"键不在白名单",值完全裸奔 —— 管理员一
 *   个手滑就能把 SESSION_EXPIRY_DAYS 写成 "abc"、BACKUP_PORT 写成 -1、
 *   JWT_SECRET 写成空字符串、OAUTH_TOKEN_EXPIRY_SECONDS 写成 0。有些地方
 *   有代码兜底(getSettingInt 会回退),有些地方没有,线上行为变得不可预测。
 *
 * 本模块给每个关键键定义了一个 validator:
 *   - 数值类型:检查是整数 + 在合理区间
 *   - 枚举类型:检查在允许值集合里
 *   - 敏感密钥:检查最小长度
 *   - 邮箱类型:检查基本格式
 *   - 路径类型:检查绝对路径
 *
 * 返回的 errors 数组是[ { key, message } ] 的列表,空表示校验全过。
 * 未在 VALIDATORS 里登记的键认为"无额外约束",视为合法 —— 不在白名单里
 * 的键早在 setSettings / route 层就已经被拒。
 *
 * 为了让管理员能"清空一个配置回退默认值",任何 validator 看到空字符串都应
 * 当放行(交由 getSetting → DEFAULTS 兜底)。只有那种"清空就崩"的关键项
 * (目前只有 JWT_SECRET in production)会单独在 route 层做"清空保护",不在
 * 这里校验。
 * ---------------------------------------------------------------------------
 */

// ── 原子级 helper ───────────────────────────────────────────────────
function isInt(v) {
  if (typeof v !== 'string') v = String(v);
  return /^-?\d+$/.test(v.trim());
}

function intInRange(min, max) {
  return (v) => {
    if (v === '' || v == null) return null;       // 清空放行
    if (!isInt(v)) return '必须是整数';
    const n = parseInt(v, 10);
    if (n < min || n > max) return `必须在 ${min} 到 ${max} 之间`;
    return null;
  };
}

function intMin(min, { allowNegativeOne = false } = {}) {
  return (v) => {
    if (v === '' || v == null) return null;
    if (!isInt(v)) return '必须是整数';
    const n = parseInt(v, 10);
    if (allowNegativeOne && n === -1) return null;
    if (n < min) return `必须 ≥ ${min}${allowNegativeOne ? '(或 -1 表示永久保留)' : ''}`;
    return null;
  };
}

function oneOf(allowed) {
  return (v) => {
    if (v === '' || v == null) return null;
    if (!allowed.includes(String(v))) return `必须是以下之一: ${allowed.join(' / ')}`;
    return null;
  };
}

function minLength(n) {
  return (v) => {
    if (v === '' || v == null) return null;
    if (String(v).length < n) return `长度至少 ${n} 个字符`;
    return null;
  };
}

function emailFormat() {
  return (v) => {
    if (v === '' || v == null) return null;
    // 简化版:有 @、@ 左右都有非空字符、右边有至少一个点
    const s = String(v).trim();
    const at = s.indexOf('@');
    if (at <= 0 || at === s.length - 1) return '不是合法的邮箱格式';
    const domain = s.slice(at + 1);
    if (!domain.includes('.') || domain.endsWith('.')) return '不是合法的邮箱格式';
    return null;
  };
}

function absolutePath() {
  return (v) => {
    if (v === '' || v == null) return null;
    if (!String(v).startsWith('/')) return '必须是绝对路径(以 / 开头)';
    return null;
  };
}

// ── 校验规则表 ──────────────────────────────────────────────────────
//
// 原则:
//   1. 清空(空字符串)一律放行 —— 配合 getSetting 回退 DEFAULTS 的语义
//   2. 上界比下界重要(防无界写爆内存 / 超长过期);下界按业务语义选
//   3. 特别敏感的东西(JWT_SECRET / OAuth client secret)最小长度卡严
const VALIDATORS = {
  // 认证
  JWT_SECRET:                       minLength(32),
  ADMIN_EMAIL:                      emailFormat(),
  SESSION_EXPIRY_DAYS:              intInRange(1, 365),

  // 邮件
  RESEND_FROM:                      emailFormat(),

  // 验证码
  VERIFICATION_CODE_EXPIRY_MINUTES: intInRange(1, 1440),   // 1 分钟 ~ 1 天
  VERIFICATION_CODE_MAX_ATTEMPTS:   intInRange(1, 100),

  // OAuth
  OAUTH_CODE_EXPIRY_MINUTES:        intInRange(1, 60),     // code 活 1h 内
  OAUTH_TOKEN_EXPIRY_SECONDS:       intInRange(60, 86400), // 1 分 ~ 1 天
  OAUTH_REFRESH_TOKEN_EXPIRY_DAYS:  intInRange(1, 365),

  // 数据保留策略
  LOGIN_HISTORY_RETENTION_DAYS:     intMin(0, { allowNegativeOne: true }),
  ACTIVITY_LOG_RETENTION_DAYS:      intMin(0, { allowNegativeOne: true }),

  // 反滥用节流 —— 所有 RL_*_MAX 与 RL_*_WINDOW_MINUTES 走同一套规则
  // MAX 至少 1(否则等于彻底封锁),窗口至少 1 分钟
  RL_LOGIN_IP_MAX:                  intInRange(1, 100000),
  RL_LOGIN_IP_WINDOW_MINUTES:       intInRange(1, 1440),
  RL_LOGIN_EMAIL_MAX:               intInRange(1, 100000),
  RL_LOGIN_EMAIL_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_REGISTER_IP_MAX:               intInRange(1, 100000),
  RL_REGISTER_IP_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_REGISTER_EMAIL_MAX:            intInRange(1, 100000),
  RL_REGISTER_EMAIL_WINDOW_MINUTES: intInRange(1, 1440),
  RL_FORGOT_IP_MAX:                 intInRange(1, 100000),
  RL_FORGOT_IP_WINDOW_MINUTES:      intInRange(1, 1440),
  RL_FORGOT_EMAIL_MAX:              intInRange(1, 100000),
  RL_FORGOT_EMAIL_WINDOW_MINUTES:   intInRange(1, 1440),
  RL_RESET_PW_IP_MAX:               intInRange(1, 100000),
  RL_RESET_PW_IP_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_CHANGE_PW_SEND_MAX:            intInRange(1, 100000),
  RL_CHANGE_PW_SEND_WINDOW_MINUTES: intInRange(1, 1440),
  RL_CHANGE_PW_SUBMIT_MAX:          intInRange(1, 100000),
  RL_CHANGE_PW_SUBMIT_WINDOW_MINUTES: intInRange(1, 1440),
  RL_VERIFY_EMAIL_IP_MAX:           intInRange(1, 100000),
  RL_VERIFY_EMAIL_IP_WINDOW_MINUTES: intInRange(1, 1440),
  RL_VERIFY_EMAIL_EMAIL_MAX:        intInRange(1, 100000),
  RL_VERIFY_EMAIL_EMAIL_WINDOW_MINUTES: intInRange(1, 1440),

  // 通用
  USER_ACTIVITY_LOG_CAP:            intMin(0, { allowNegativeOne: true }),

  // Turnstile
  TURNSTILE_ENABLED:                oneOf(['0', '1']),

  // 备份
  BACKUP_ENABLED:                   oneOf(['0', '1']),
  BACKUP_PORT:                      intInRange(1, 65535),
  BACKUP_AUTH_METHOD:               oneOf(['password', 'key']),
  BACKUP_REMOTE_DIR:                absolutePath(),
  BACKUP_HISTORY_KEEP:              intMin(0),
};

/**
 * 按"键名后缀匹配"兜底一些 OAuth client secret 的最小长度要求。
 * 静态 client 的 secretEnv 名字由 config/oauth-clients.js 决定,一般叫
 * 诸如 QISHU_DEFAULT_CLIENT_SECRET —— 这里用后缀约定 _CLIENT_SECRET
 * 匹配,保证新加 client 时也自动受保护。
 */
function suffixValidator(key) {
  if (key.endsWith('_CLIENT_SECRET')) return minLength(16);
  return null;
}

/**
 * 批量校验。entries 是 { KEY: value } 的对象。
 * 返回 { errors: [ { key, message } ] }。空数组表示全过。
 */
export function validateSettings(entries) {
  const errors = [];
  for (const [key, rawValue] of Object.entries(entries || {})) {
    const value = rawValue == null ? '' : String(rawValue);
    const v = VALIDATORS[key] || suffixValidator(key);
    if (!v) continue;
    const msg = v(value);
    if (msg) errors.push({ key, message: msg });
  }
  return { errors };
}
