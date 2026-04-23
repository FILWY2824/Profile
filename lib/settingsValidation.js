/**
 * lib/settingsValidation.js —— 受管配置项的值校验
 * ---------------------------------------------------------------------------
 * 说明:
 *   • 这里只校验仍允许在后台修改的项
 *   • JWT_SECRET 已迁回环境变量管理,不再接受后台修改
 *   • 数据库备份功能已移除,相关 BACKUP_* 配置全部废弃
 * ---------------------------------------------------------------------------
 */

function isInt(v) {
  if (typeof v !== 'string') v = String(v);
  return /^-?\d+$/.test(v.trim());
}

function intInRange(min, max) {
  return (v) => {
    if (v === '' || v == null) return null;
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
    const s = String(v).trim();
    const at = s.indexOf('@');
    if (at <= 0 || at === s.length - 1) return '不是合法的邮箱格式';
    const domain = s.slice(at + 1);
    if (!domain.includes('.') || domain.endsWith('.')) return '不是合法的邮箱格式';
    return null;
  };
}

const VALIDATORS = {
  ADMIN_EMAIL:                      emailFormat(),
  SESSION_EXPIRY_DAYS:              intInRange(1, 365),
  RESEND_FROM:                      emailFormat(),
  VERIFICATION_CODE_EXPIRY_MINUTES: intInRange(1, 1440),
  VERIFICATION_CODE_MAX_ATTEMPTS:   intInRange(1, 100),
  OAUTH_CODE_EXPIRY_MINUTES:        intInRange(1, 60),
  OAUTH_TOKEN_EXPIRY_SECONDS:       intInRange(60, 86400),
  OAUTH_REFRESH_TOKEN_EXPIRY_DAYS:  intInRange(1, 365),
  LOGIN_HISTORY_RETENTION_DAYS:     intMin(0, { allowNegativeOne: true }),
  ACTIVITY_LOG_RETENTION_DAYS:      intMin(0, { allowNegativeOne: true }),
  RL_LOGIN_IP_MAX:                  intInRange(1, 10000),
  RL_LOGIN_IP_WINDOW_MINUTES:       intInRange(1, 1440),
  RL_LOGIN_EMAIL_MAX:               intInRange(1, 10000),
  RL_LOGIN_EMAIL_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_REGISTER_IP_MAX:               intInRange(1, 10000),
  RL_REGISTER_IP_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_REGISTER_EMAIL_MAX:            intInRange(1, 10000),
  RL_REGISTER_EMAIL_WINDOW_MINUTES: intInRange(1, 1440),
  RL_FORGOT_IP_MAX:                 intInRange(1, 10000),
  RL_FORGOT_IP_WINDOW_MINUTES:      intInRange(1, 1440),
  RL_FORGOT_EMAIL_MAX:              intInRange(1, 10000),
  RL_FORGOT_EMAIL_WINDOW_MINUTES:   intInRange(1, 1440),
  RL_RESET_PW_IP_MAX:               intInRange(1, 10000),
  RL_RESET_PW_IP_WINDOW_MINUTES:    intInRange(1, 1440),
  RL_CHANGE_PW_SEND_MAX:            intInRange(1, 10000),
  RL_CHANGE_PW_SEND_WINDOW_MINUTES: intInRange(1, 1440),
  RL_CHANGE_PW_SUBMIT_MAX:          intInRange(1, 10000),
  RL_CHANGE_PW_SUBMIT_WINDOW_MINUTES: intInRange(1, 1440),
  RL_VERIFY_EMAIL_IP_MAX:           intInRange(1, 10000),
  RL_VERIFY_EMAIL_IP_WINDOW_MINUTES: intInRange(1, 1440),
  RL_VERIFY_EMAIL_EMAIL_MAX:        intInRange(1, 10000),
  RL_VERIFY_EMAIL_EMAIL_WINDOW_MINUTES: intInRange(1, 1440),
  USER_ACTIVITY_LOG_CAP:            intMin(0, { allowNegativeOne: true }),
  TURNSTILE_ENABLED:                oneOf(['0', '1']),
};

function suffixValidator(key) {
  if (key.endsWith('_CLIENT_SECRET')) return minLength(16);
  return null;
}

export function validateSettings(entries) {
  const errors = [];
  for (const [key, rawValue] of Object.entries(entries || {})) {
    const value = rawValue == null ? '' : String(rawValue);
    const validator = VALIDATORS[key] || suffixValidator(key);
    if (!validator) continue;
    const message = validator(value);
    if (message) errors.push({ key, message });
  }
  return { errors };
}
