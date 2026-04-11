const { AppError } = require("./lib-errors");
const { createNumericCode, hashPassword, hashValue, verifyPassword } = require("./lib-crypto");
const {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateUsername,
  validateVerificationCode
} = require("./lib-validators");

const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt
});

const createAuthService = ({ config, mailService, store }) => {
  const ensureUserUniqueness = ({ username, email }, currentUserId = null, messageOverrides = {}) => {
    if (username) {
      const existingByUsername = store.findUserByUsername(username);
      if (existingByUsername && existingByUsername.id !== currentUserId) {
        throw new AppError(409, messageOverrides.username || "用户名已存在。");
      }
    }

    if (email) {
      const existingByEmail = store.findUserByEmail(email);
      if (existingByEmail && existingByEmail.id !== currentUserId) {
        throw new AppError(409, messageOverrides.email || "该邮箱已被占用。");
      }
    }
  };

  const requestRegisterCode = async (payload) => {
    const username = validateUsername(payload.username);
    const email = validateEmail(payload.email);
    const password = validatePassword(payload.password, config);
    const displayName = username;

    ensureUserUniqueness({ username, email });

    const passwordPayload = await hashPassword(password);
    const code = createNumericCode(config.auth.verificationCodeLength);

    await store.createVerification({
      purpose: "register",
      email,
      codeHash: hashValue(code),
      payload: {
        username,
        displayName,
        email,
        passwordHash: passwordPayload.hash,
        salt: passwordPayload.salt
      },
      expiresAt: new Date(Date.now() + config.auth.verificationTtlMs).toISOString()
    });

    try {
      const delivery = await mailService.sendVerificationCode({
        purpose: "register",
        email,
        displayName,
        code
      });

      return {
        message:
          delivery.mode === "email"
            ? "验证码已发送到你的邮箱。"
            : "验证码已生成，当前未配置 Resend，已打印到服务端控制台。"
      };
    } catch (error) {
      await store.removeVerification("register", email);
      throw new AppError(500, `验证码发送失败：${error.message}`);
    }
  };

  const verifyRegisterCode = async (payload) => {
    const email = validateEmail(payload.email);
    const code = validateVerificationCode(payload.code, config);
    const verification = await store.consumeVerification({
      purpose: "register",
      email,
      codeHash: hashValue(code)
    });

    if (verification.status === "missing") {
      throw new AppError(400, "验证码不存在或已过期。");
    }

    if (verification.status === "invalid") {
      throw new AppError(400, "验证码错误。");
    }

    const registrationPayload = verification.entry.payload;
    ensureUserUniqueness(
      {
        username: registrationPayload.username,
        email: registrationPayload.email
      },
      null,
      {
        username: "用户名已被占用，请重新发起注册。",
        email: "该邮箱已完成注册，请直接登录。"
      }
    );

    const timestamp = new Date().toISOString();
    const user = await store.createUser({
      username: registrationPayload.username,
      displayName: registrationPayload.displayName || registrationPayload.username,
      email: registrationPayload.email,
      role: "normal",
      status: "active",
      passwordHash: registrationPayload.passwordHash,
      salt: registrationPayload.salt,
      createdAt: timestamp,
      lastLoginAt: timestamp
    });

    return {
      message: "注册成功，已自动登录。",
      user: sanitizeUser(user)
    };
  };

  const login = async (payload) => {
    const account = String(payload.account || payload.username || "").trim();
    const password = validatePassword(payload.password, config);

    if (!account) {
      throw new AppError(400, "请输入用户名或邮箱。");
    }

    const user = store.findUserByLogin(account, normalizeEmail(account));
    if (!user) {
      throw new AppError(401, "用户名、邮箱或密码错误。");
    }

    if (user.status !== "active") {
      throw new AppError(403, "当前账号已被停用，请联系管理员。");
    }

    const isValid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      throw new AppError(401, "用户名、邮箱或密码错误。");
    }

    const touchedUser = await store.touchUserLastLogin(user.id, new Date().toISOString());
    return {
      message: "登录成功。",
      user: sanitizeUser(touchedUser || user)
    };
  };

  const requestPasswordReset = async (payload) => {
    const email = validateEmail(payload.email);
    const user = store.findUserByEmail(email);

    if (!user) {
      return {
        message: "如果该邮箱已注册，验证码将很快发送。"
      };
    }

    const code = createNumericCode(config.auth.verificationCodeLength);

    await store.createVerification({
      purpose: "reset-password",
      email,
      codeHash: hashValue(code),
      payload: {
        userId: user.id,
        email: user.email
      },
      expiresAt: new Date(Date.now() + config.auth.verificationTtlMs).toISOString()
    });

    try {
      const delivery = await mailService.sendVerificationCode({
        purpose: "reset-password",
        email,
        displayName: user.displayName || user.username,
        code
      });

      return {
        message:
          delivery.mode === "email"
            ? "找回密码验证码已发送。"
            : "验证码已生成，当前未配置 Resend，已打印到服务端控制台。"
      };
    } catch (error) {
      await store.removeVerification("reset-password", email);
      throw new AppError(500, `验证码发送失败：${error.message}`);
    }
  };

  const resetPassword = async (payload) => {
    const email = validateEmail(payload.email);
    const code = validateVerificationCode(payload.code, config);
    const newPassword = validatePassword(payload.newPassword, config);
    const verification = await store.consumeVerification({
      purpose: "reset-password",
      email,
      codeHash: hashValue(code)
    });

    if (verification.status === "missing") {
      throw new AppError(400, "验证码不存在或已过期。");
    }

    if (verification.status === "invalid") {
      throw new AppError(400, "验证码错误。");
    }

    const user = store.findUserById(verification.entry.payload.userId);
    if (!user || user.email !== email) {
      throw new AppError(404, "用户不存在。");
    }

    const passwordPayload = await hashPassword(newPassword);
    await store.replaceUserPassword(user.id, passwordPayload);
    await store.deleteSessionsForUser(user.id);

    return {
      message: "密码已重置，请使用新密码重新登录。"
    };
  };

  const requestEmailChangeCode = async (userId, payload) => {
    const user = store.findUserById(userId);
    if (!user) {
      throw new AppError(404, "用户不存在。");
    }

    if (user.status !== "active") {
      throw new AppError(403, "当前账号已被停用，无法修改邮箱。");
    }

    const nextEmail = validateEmail(payload.email);
    if (nextEmail === user.email) {
      throw new AppError(400, "新邮箱不能与当前邮箱相同。");
    }

    ensureUserUniqueness({ email: nextEmail }, user.id, {
      email: "该邮箱已被其他账号使用。"
    });

    const code = createNumericCode(config.auth.verificationCodeLength);

    await store.createVerification({
      purpose: "change-email",
      email: nextEmail,
      codeHash: hashValue(code),
      payload: {
        userId: user.id,
        nextEmail
      },
      expiresAt: new Date(Date.now() + config.auth.verificationTtlMs).toISOString()
    });

    try {
      const delivery = await mailService.sendVerificationCode({
        purpose: "change-email",
        email: nextEmail,
        displayName: user.displayName || user.username,
        code
      });

      return {
        message:
          delivery.mode === "email"
            ? "新邮箱验证码已发送。"
            : "验证码已生成，当前未配置 Resend，已打印到服务端控制台。"
      };
    } catch (error) {
      await store.removeVerification("change-email", nextEmail);
      throw new AppError(500, `验证码发送失败：${error.message}`);
    }
  };

  const updateProfile = async (userId, payload) => {
    const user = store.findUserById(userId);
    if (!user) {
      throw new AppError(404, "用户不存在。");
    }

    if (user.status !== "active") {
      throw new AppError(403, "当前账号已被停用，无法修改资料。");
    }

    const currentPassword = validatePassword(payload.currentPassword, config);
    const validPassword = await verifyPassword(currentPassword, user.passwordHash, user.salt);
    if (!validPassword) {
      throw new AppError(401, "当前密码错误。");
    }

    const nextUsername =
      payload.username === undefined ? user.username : validateUsername(payload.username);
    const nextEmail = payload.email === undefined ? user.email : validateEmail(payload.email);
    const hasEmailChange = nextEmail !== user.email;
    const hasPasswordChange =
      payload.newPassword !== undefined && String(payload.newPassword || "").trim().length > 0;

    ensureUserUniqueness({ username: nextUsername, email: nextEmail }, user.id, {
      email: "该邮箱已被其他账号使用。"
    });

    if (hasEmailChange) {
      const emailCode = validateVerificationCode(payload.emailCode, config);
      const verification = await store.consumeVerification({
        purpose: "change-email",
        email: nextEmail,
        codeHash: hashValue(emailCode)
      });

      if (verification.status === "missing") {
        throw new AppError(400, "邮箱验证码不存在或已过期。");
      }

      if (verification.status === "invalid") {
        throw new AppError(400, "邮箱验证码错误。");
      }

      const verificationPayload = verification.entry.payload || {};
      if (verificationPayload.userId !== user.id || verificationPayload.nextEmail !== nextEmail) {
        throw new AppError(400, "邮箱验证码与当前修改请求不匹配。");
      }
    }

    const patch = {};
    if (nextUsername !== user.username) {
      patch.username = nextUsername;
      patch.displayName = nextUsername;
    }

    if (hasEmailChange) {
      patch.email = nextEmail;
    }

    if (!Object.keys(patch).length && !hasPasswordChange) {
      throw new AppError(400, "没有可更新的账号信息。");
    }

    let updatedUser = user;
    if (Object.keys(patch).length) {
      updatedUser = await store.updateUser(user.id, patch);
    }

    let passwordChanged = false;
    if (hasPasswordChange) {
      const newPassword = validatePassword(payload.newPassword, config);
      const samePassword = await verifyPassword(newPassword, user.passwordHash, user.salt);
      if (samePassword) {
        throw new AppError(400, "新密码不能与当前密码相同。");
      }

      const passwordPayload = await hashPassword(newPassword);
      updatedUser = await store.replaceUserPassword(user.id, passwordPayload);
      passwordChanged = true;
    }

    return {
      message: passwordChanged ? "资料已更新，登录状态已刷新。" : "资料已更新。",
      passwordChanged,
      user: sanitizeUser(updatedUser || user)
    };
  };

  return {
    login,
    requestEmailChangeCode,
    requestPasswordReset,
    requestRegisterCode,
    resetPassword,
    updateProfile,
    verifyRegisterCode
  };
};

module.exports = {
  createAuthService
};
