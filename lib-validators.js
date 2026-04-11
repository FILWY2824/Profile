const { AppError } = require("./lib-errors");

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const validateUsername = (username) => {
  const normalized = String(username || "").trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/u.test(normalized)) {
    throw new AppError(400, "用户名必须为 3-24 位字母、数字或下划线。");
  }

  return normalized;
};

const validateEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) || normalized.length > 128) {
    throw new AppError(400, "请输入有效的邮箱地址。");
  }

  return normalized;
};

const validatePassword = (password, config) => {
  const normalized = String(password || "");
  if (
    normalized.length < config.auth.passwordMinLength ||
    normalized.length > config.auth.passwordMaxLength
  ) {
    throw new AppError(
      400,
      `密码长度必须在 ${config.auth.passwordMinLength} 到 ${config.auth.passwordMaxLength} 个字符之间。`
    );
  }

  return normalized;
};

const validateVerificationCode = (code, config) => {
  const normalized = String(code || "").trim();
  const pattern = new RegExp(`^\\d{${config.auth.verificationCodeLength}}$`, "u");

  if (!pattern.test(normalized)) {
    throw new AppError(400, `验证码必须是 ${config.auth.verificationCodeLength} 位数字。`);
  }

  return normalized;
};

module.exports = {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateUsername,
  validateVerificationCode
};
