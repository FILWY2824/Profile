const path = require("path");
const { loadEnvFiles } = require("./config-env");

const rootDir = __dirname;
loadEnvFiles(rootDir);

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const config = {
  app: {
    name: process.env.APP_NAME || "栖枢",
    version: process.env.APP_VERSION || "1.0.0"
  },
  env: process.env.NODE_ENV || "development",
  paths: {
    rootDir,
    dataDir: path.join(rootDir, "data"),
    storeFile: path.join(rootDir, "data", "store.json")
  },
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: toNumber(process.env.PORT, 3000),
    trustProxy: toBoolean(process.env.TRUST_PROXY, false)
  },
  http: {
    maxBodyBytes: toNumber(process.env.MAX_BODY_BYTES, 1024 * 64),
    staticAssetMaxAgeSeconds: toNumber(process.env.STATIC_ASSET_MAX_AGE_SECONDS, 60 * 5)
  },
  security: {
    cookieName: process.env.SESSION_COOKIE_NAME || "alma_session",
    sessionMaxAgeMs: toNumber(process.env.SESSION_MAX_AGE_MS, 1000 * 60 * 60 * 24 * 7),
    secureCookies: toBoolean(
      process.env.SECURE_COOKIES,
      (process.env.NODE_ENV || "").toLowerCase() === "production"
    ),
    contentSecurityPolicy:
      process.env.CONTENT_SECURITY_POLICY ||
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  },
  auth: {
    verificationTtlMs: toNumber(process.env.VERIFICATION_TTL_MS, 1000 * 60 * 10),
    maxVerificationAttempts: toNumber(process.env.MAX_VERIFICATION_ATTEMPTS, 5),
    verificationCodeLength: toNumber(process.env.VERIFICATION_CODE_LENGTH, 6),
    passwordMinLength: toNumber(process.env.PASSWORD_MIN_LENGTH, 8),
    passwordMaxLength: toNumber(process.env.PASSWORD_MAX_LENGTH, 64),
    maxSessionsPerUser: toNumber(process.env.MAX_SESSIONS_PER_USER, 20)
  },
  rateLimits: {
    login: {
      windowMs: toNumber(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 1000 * 60 * 10),
      max: toNumber(process.env.RATE_LIMIT_LOGIN_MAX, 20)
    },
    verificationRequest: {
      windowMs: toNumber(process.env.RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS, 1000 * 60 * 10),
      max: toNumber(process.env.RATE_LIMIT_VERIFY_REQUEST_MAX, 8)
    },
    verificationVerify: {
      windowMs: toNumber(process.env.RATE_LIMIT_VERIFY_CHECK_WINDOW_MS, 1000 * 60 * 10),
      max: toNumber(process.env.RATE_LIMIT_VERIFY_CHECK_MAX, 20)
    },
    adminWrite: {
      windowMs: toNumber(process.env.RATE_LIMIT_ADMIN_WINDOW_MS, 1000 * 60),
      max: toNumber(process.env.RATE_LIMIT_ADMIN_MAX, 60)
    }
  },
  mail: {
    provider: "resend",
    from: process.env.MAIL_FROM || process.env.ADMIN_EMAIL || "admin@teamcy.eu.cc",
    replyTo:
      process.env.MAIL_REPLY_TO ||
      process.env.MAIL_FROM ||
      process.env.ADMIN_EMAIL ||
      "admin@teamcy.eu.cc",
    resendApiKey: process.env.RESEND_API_KEY || "",
    devLogCodes: toBoolean(process.env.MAIL_DEV_LOG_CODES, true)
  },
  adminSeed: {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "Admin@123456",
    email: process.env.ADMIN_EMAIL || "admin@teamcy.eu.cc",
    displayName: process.env.ADMIN_DISPLAY_NAME || "系统管理员"
  }
};

module.exports = {
  config
};
