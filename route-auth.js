const { AppError } = require("./lib-errors");

const takeRateLimit = (limiter, rule, key) => {
  const result = limiter.take(key, rule);
  if (!result.allowed) {
    throw new AppError(429, "请求过于频繁，请稍后再试。", {
      retryAfterMs: result.retryAfterMs
    });
  }
};

const requireCurrentUser = (sessionService, request) => {
  const user = sessionService.getCurrentUser(request);
  if (!user) {
    throw new AppError(401, "请先登录后再操作。");
  }
  return user;
};

const registerAuthRoutes = (router, dependencies) => {
  const { authService, config, rateLimiter, sessionService, store } = dependencies;

  router.add("GET", "/api/auth/me", async (context) => {
    context.json(200, {
      user: sessionService.getCurrentUser(context.request)
    });
  });

  router.add("PATCH", "/api/auth/profile", async (context) => {
    const currentUser = requireCurrentUser(sessionService, context.request);
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.login, `profile:${context.ip}`);
    const payload = await authService.updateProfile(currentUser.id, body);

    if (payload.passwordChanged) {
      await store.deleteSessionsForUser(currentUser.id);
      await sessionService.issueSession(context.response, currentUser.id);
    }

    context.json(200, payload);
  });

  router.add("POST", "/api/auth/request-email-change-code", async (context) => {
    const currentUser = requireCurrentUser(sessionService, context.request);
    const body = await context.readJson();
    takeRateLimit(
      rateLimiter,
      config.rateLimits.verificationRequest,
      `change-email:${currentUser.id}:${context.ip}`
    );
    const payload = await authService.requestEmailChangeCode(currentUser.id, body);
    context.json(200, payload);
  });

  router.add("POST", "/api/auth/request-register-code", async (context) => {
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.verificationRequest, `register:${context.ip}`);
    const payload = await authService.requestRegisterCode(body);
    context.json(200, payload);
  });

  router.add("POST", "/api/auth/verify-register-code", async (context) => {
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.verificationVerify, `verify-register:${context.ip}`);
    const payload = await authService.verifyRegisterCode(body);
    await sessionService.issueSession(context.response, payload.user.id);
    context.json(201, payload);
  });

  router.add("POST", "/api/auth/request-password-reset", async (context) => {
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.verificationRequest, `request-reset:${context.ip}`);
    const payload = await authService.requestPasswordReset(body);
    context.json(200, payload);
  });

  router.add("POST", "/api/auth/reset-password", async (context) => {
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.verificationVerify, `reset-password:${context.ip}`);
    const payload = await authService.resetPassword(body);
    sessionService.clearSessionCookie(context.response);
    context.json(200, payload);
  });

  router.add("POST", "/api/auth/login", async (context) => {
    const body = await context.readJson();
    takeRateLimit(rateLimiter, config.rateLimits.login, `login:${context.ip}`);
    const payload = await authService.login(body);
    await sessionService.issueSession(context.response, payload.user.id);
    context.json(200, payload);
  });

  router.add("POST", "/api/auth/logout", async (context) => {
    await sessionService.destroyCurrentSession(context.request, context.response);
    context.json(200, {
      message: "已退出登录。"
    });
  });
};

module.exports = {
  registerAuthRoutes
};
