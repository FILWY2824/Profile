const fs = require("fs/promises");
const path = require("path");
const { AppError } = require("./lib-errors");
const { parseEnvContent } = require("./config-env");

const ENV_FILE_ORDER = [
  "APP_NAME",
  "APP_VERSION",
  "NODE_ENV",
  "HOST",
  "PORT",
  "TRUST_PROXY",
  "MAX_BODY_BYTES",
  "STATIC_ASSET_MAX_AGE_SECONDS",
  "SESSION_COOKIE_NAME",
  "SESSION_MAX_AGE_MS",
  "SECURE_COOKIES",
  "CONTENT_SECURITY_POLICY",
  "VERIFICATION_TTL_MS",
  "VERIFICATION_CODE_LENGTH",
  "MAX_VERIFICATION_ATTEMPTS",
  "PASSWORD_MIN_LENGTH",
  "PASSWORD_MAX_LENGTH",
  "MAX_SESSIONS_PER_USER",
  "RATE_LIMIT_LOGIN_WINDOW_MS",
  "RATE_LIMIT_LOGIN_MAX",
  "RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS",
  "RATE_LIMIT_VERIFY_REQUEST_MAX",
  "RATE_LIMIT_VERIFY_CHECK_WINDOW_MS",
  "RATE_LIMIT_VERIFY_CHECK_MAX",
  "RATE_LIMIT_ADMIN_WINDOW_MS",
  "RATE_LIMIT_ADMIN_MAX",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_EMAIL",
  "ADMIN_DISPLAY_NAME",
  "MAIL_FROM",
  "MAIL_REPLY_TO",
  "RESEND_API_KEY",
  "MAIL_DEV_LOG_CODES"
];

const EDITABLE_FIELDS = {
  APP_NAME: { type: "string", maxLength: 60 },
  APP_VERSION: { type: "string", maxLength: 24 },
  HOST: { type: "string", maxLength: 120 },
  PORT: { type: "number", min: 1, max: 65535 },
  TRUST_PROXY: { type: "boolean" },
  MAX_BODY_BYTES: { type: "number", min: 1024, max: 1048576 },
  STATIC_ASSET_MAX_AGE_SECONDS: { type: "number", min: 0, max: 86400 },
  SESSION_COOKIE_NAME: { type: "string", maxLength: 64 },
  SESSION_MAX_AGE_MS: { type: "number", min: 60000, max: 31536000000 },
  SECURE_COOKIES: { type: "boolean" },
  VERIFICATION_TTL_MS: { type: "number", min: 60000, max: 3600000 },
  VERIFICATION_CODE_LENGTH: { type: "number", min: 4, max: 8 },
  MAX_VERIFICATION_ATTEMPTS: { type: "number", min: 1, max: 20 },
  PASSWORD_MIN_LENGTH: { type: "number", min: 6, max: 128 },
  PASSWORD_MAX_LENGTH: { type: "number", min: 8, max: 256 },
  MAX_SESSIONS_PER_USER: { type: "number", min: 1, max: 200 },
  RATE_LIMIT_LOGIN_WINDOW_MS: { type: "number", min: 1000, max: 86400000 },
  RATE_LIMIT_LOGIN_MAX: { type: "number", min: 1, max: 10000 },
  RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS: { type: "number", min: 1000, max: 86400000 },
  RATE_LIMIT_VERIFY_REQUEST_MAX: { type: "number", min: 1, max: 10000 },
  RATE_LIMIT_VERIFY_CHECK_WINDOW_MS: { type: "number", min: 1000, max: 86400000 },
  RATE_LIMIT_VERIFY_CHECK_MAX: { type: "number", min: 1, max: 10000 },
  RATE_LIMIT_ADMIN_WINDOW_MS: { type: "number", min: 1000, max: 86400000 },
  RATE_LIMIT_ADMIN_MAX: { type: "number", min: 1, max: 10000 },
  MAIL_FROM: { type: "string", maxLength: 255 },
  MAIL_REPLY_TO: { type: "string", maxLength: 255 },
  RESEND_API_KEY: { type: "secret", maxLength: 255 },
  MAIL_DEV_LOG_CODES: { type: "boolean" }
};

const toBooleanString = (value) => (value ? "true" : "false");

const quoteIfNeeded = (value) => {
  const stringValue = String(value);
  if (/[\s#"'=]/u.test(stringValue)) {
    return JSON.stringify(stringValue);
  }
  return stringValue;
};

const normalizeValue = (field, value, currentValue) => {
  const rule = EDITABLE_FIELDS[field];
  if (!rule) {
    return currentValue;
  }

  if (rule.type === "secret") {
    if (value === undefined) {
      return currentValue;
    }

    const normalized = String(value || "");
    if (!normalized.trim()) {
      return currentValue;
    }

    if (normalized.length > rule.maxLength) {
      throw new AppError(400, `${field} 长度过长。`);
    }

    return normalized;
  }

  if (value === undefined) {
    return currentValue;
  }

  if (rule.type === "string") {
    const normalized = String(value || "").trim();
    if (!normalized) {
      throw new AppError(400, `${field} 不能为空。`);
    }
    if (normalized.length > rule.maxLength) {
      throw new AppError(400, `${field} 长度不能超过 ${rule.maxLength} 个字符。`);
    }
    return normalized;
  }

  if (rule.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new AppError(400, `${field} 必须是整数。`);
    }
    if (parsed < rule.min || parsed > rule.max) {
      throw new AppError(400, `${field} 取值必须在 ${rule.min} 到 ${rule.max} 之间。`);
    }
    return String(parsed);
  }

  if (rule.type === "boolean") {
    return toBooleanString(Boolean(value));
  }

  return currentValue;
};

const buildEnvContent = (envObject) =>
  ENV_FILE_ORDER.filter((key) => envObject[key] !== undefined)
    .map((key) => `${key}=${quoteIfNeeded(envObject[key])}`)
    .join("\n")
    .concat("\n");

const createRuntimeConfigService = ({ config }) => {
  const envPath = path.join(config.paths.rootDir, ".env");

  const readCurrentEnv = async () => {
    try {
      const content = await fs.readFile(envPath, "utf8");
      return parseEnvContent(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  };

  const getRuntimeConfig = async () => {
    const envObject = await readCurrentEnv();
    const merged = {};

    ENV_FILE_ORDER.forEach((key) => {
      if (envObject[key] !== undefined) {
        merged[key] = envObject[key];
      } else if (process.env[key] !== undefined) {
        merged[key] = process.env[key];
      }
    });

    return {
      APP_NAME: merged.APP_NAME || "",
      APP_VERSION: merged.APP_VERSION || "",
      HOST: merged.HOST || "",
      PORT: merged.PORT || "",
      TRUST_PROXY: merged.TRUST_PROXY === "true",
      MAX_BODY_BYTES: merged.MAX_BODY_BYTES || "",
      STATIC_ASSET_MAX_AGE_SECONDS: merged.STATIC_ASSET_MAX_AGE_SECONDS || "",
      SESSION_COOKIE_NAME: merged.SESSION_COOKIE_NAME || "",
      SESSION_MAX_AGE_MS: merged.SESSION_MAX_AGE_MS || "",
      SECURE_COOKIES: merged.SECURE_COOKIES === "true",
      VERIFICATION_TTL_MS: merged.VERIFICATION_TTL_MS || "",
      VERIFICATION_CODE_LENGTH: merged.VERIFICATION_CODE_LENGTH || "",
      MAX_VERIFICATION_ATTEMPTS: merged.MAX_VERIFICATION_ATTEMPTS || "",
      PASSWORD_MIN_LENGTH: merged.PASSWORD_MIN_LENGTH || "",
      PASSWORD_MAX_LENGTH: merged.PASSWORD_MAX_LENGTH || "",
      MAX_SESSIONS_PER_USER: merged.MAX_SESSIONS_PER_USER || "",
      RATE_LIMIT_LOGIN_WINDOW_MS: merged.RATE_LIMIT_LOGIN_WINDOW_MS || "",
      RATE_LIMIT_LOGIN_MAX: merged.RATE_LIMIT_LOGIN_MAX || "",
      RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS: merged.RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS || "",
      RATE_LIMIT_VERIFY_REQUEST_MAX: merged.RATE_LIMIT_VERIFY_REQUEST_MAX || "",
      RATE_LIMIT_VERIFY_CHECK_WINDOW_MS: merged.RATE_LIMIT_VERIFY_CHECK_WINDOW_MS || "",
      RATE_LIMIT_VERIFY_CHECK_MAX: merged.RATE_LIMIT_VERIFY_CHECK_MAX || "",
      RATE_LIMIT_ADMIN_WINDOW_MS: merged.RATE_LIMIT_ADMIN_WINDOW_MS || "",
      RATE_LIMIT_ADMIN_MAX: merged.RATE_LIMIT_ADMIN_MAX || "",
      MAIL_FROM: merged.MAIL_FROM || "",
      MAIL_REPLY_TO: merged.MAIL_REPLY_TO || "",
      RESEND_API_KEY: "",
      RESEND_API_KEY_SET: Boolean(merged.RESEND_API_KEY),
      MAIL_DEV_LOG_CODES: merged.MAIL_DEV_LOG_CODES === "true"
    };
  };

  const updateRuntimeConfig = async (payload) => {
    const currentEnv = await readCurrentEnv();
    const nextEnv = { ...currentEnv };

    Object.keys(EDITABLE_FIELDS).forEach((field) => {
      nextEnv[field] = normalizeValue(field, payload[field], currentEnv[field] || process.env[field] || "");
    });

    await fs.writeFile(envPath, buildEnvContent(nextEnv), "utf8");

    return {
      message: "配置文件已写入 .env，部分设置需要重启服务后生效。",
      config: await getRuntimeConfig(),
      restartRecommended: true
    };
  };

  return {
    getRuntimeConfig,
    updateRuntimeConfig
  };
};

module.exports = {
  createRuntimeConfigService
};
