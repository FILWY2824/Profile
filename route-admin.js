const { AppError } = require("./lib-errors");

const takeRateLimit = (limiter, rule, key) => {
  const result = limiter.take(key, rule);
  if (!result.allowed) {
    throw new AppError(429, "请求过于频繁，请稍后再试。", {
      retryAfterMs: result.retryAfterMs
    });
  }
};

const registerAdminRoutes = (router, dependencies) => {
  const { adminService, config, portalService, rateLimiter, runtimeConfigService, sessionService } =
    dependencies;

  const ensureAdmin = (request) => {
    const user = sessionService.getCurrentUser(request);
    if (!user || user.role !== "admin") {
      throw new AppError(403, "需要管理员权限。");
    }

    return user;
  };

  router.add("GET", "/api/admin/users", async (context) => {
    ensureAdmin(context.request);
    context.json(200, {
      users: adminService.listUsers()
    });
  });

  router.add("PATCH", "/api/admin/users/:userId", async (context) => {
    const actor = ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-write:${context.ip}`);
    const body = await context.readJson();
    const payload = await adminService.updateUser(context.params.userId, body, actor);
    context.json(200, payload);
  });

  router.add("DELETE", "/api/admin/users/:userId", async (context) => {
    const actor = ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-delete:${context.ip}`);
    const payload = await adminService.deleteUser(context.params.userId, actor);
    context.json(200, payload);
  });

  router.add("GET", "/api/admin/portal", async (context) => {
    ensureAdmin(context.request);
    context.json(200, {
      portal: portalService.getAdminPortalConfig()
    });
  });

  router.add("PATCH", "/api/admin/portal/site", async (context) => {
    ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-site:${context.ip}`);
    const body = await context.readJson();
    const payload = await portalService.updateSite(body);
    context.json(200, payload);
  });

  router.add("PATCH", "/api/admin/portal/modules", async (context) => {
    ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-modules:${context.ip}`);
    const body = await context.readJson();
    const payload = await portalService.updateModules(body);
    context.json(200, payload);
  });

  router.add("PATCH", "/api/admin/portal/modules/:moduleKey", async (context) => {
    ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-module:${context.ip}`);
    const body = await context.readJson();
    const payload = await portalService.updateModule(context.params.moduleKey, body);
    context.json(200, payload);
  });

  router.add("GET", "/api/admin/runtime-config", async (context) => {
    ensureAdmin(context.request);
    context.json(200, {
      config: await runtimeConfigService.getRuntimeConfig()
    });
  });

  router.add("PATCH", "/api/admin/runtime-config", async (context) => {
    ensureAdmin(context.request);
    takeRateLimit(rateLimiter, config.rateLimits.adminWrite, `admin-runtime:${context.ip}`);
    const body = await context.readJson();
    const payload = await runtimeConfigService.updateRuntimeConfig(body);
    context.json(200, payload);
  });
};

module.exports = {
  registerAdminRoutes
};
