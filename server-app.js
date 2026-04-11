const http = require("http");
const { config } = require("./config-app");
const { isAppError } = require("./lib-errors");
const { getClientIp, readJsonBody, sendJson } = require("./lib-http");
const { MemoryRateLimiter } = require("./lib-rate-limiter");
const { createRouter } = require("./router");
const { createAdminService } = require("./service-admin");
const { createAuthService } = require("./service-auth");
const { createMailService } = require("./service-mail");
const { createPortalService } = require("./service-portal");
const { createRuntimeConfigService } = require("./service-runtime-config");
const { createSessionService } = require("./service-session");
const { FileStore } = require("./store-file");
const { registerAdminRoutes } = require("./route-admin");
const { registerAuthRoutes } = require("./route-auth");
const { registerHealthRoute } = require("./route-health");
const { registerPortalRoutes } = require("./route-portal");
const { createStaticRouteHandler } = require("./route-static");

const createDependencies = async () => {
  const store = new FileStore(config);
  await store.initialize();

  const mailService = createMailService(config);
  const sessionService = createSessionService({
    config,
    store
  });
  const authService = createAuthService({
    config,
    mailService,
    store
  });
  const adminService = createAdminService({
    store
  });
  const portalService = createPortalService({
    store
  });
  const runtimeConfigService = createRuntimeConfigService({
    config
  });

  return {
    adminService,
    authService,
    config,
    mailService,
    portalService,
    rateLimiter: new MemoryRateLimiter(),
    runtimeConfigService,
    sessionService,
    store
  };
};

const createRequestContext = (request, response, url, params, dependencies) => ({
  config,
  ip: getClientIp(request, config.server.trustProxy),
  json: (statusCode, payload, headers = {}) => sendJson(response, config, statusCode, payload, headers),
  params,
  pathname: url.pathname,
  readJson: () => readJsonBody(request, config.http.maxBodyBytes),
  request,
  response,
  url,
  ...dependencies
});

const createApp = async () => {
  const dependencies = await createDependencies();
  const router = createRouter();
  const staticHandler = createStaticRouteHandler(config);

  registerHealthRoute(router, dependencies);
  registerPortalRoutes(router, dependencies);
  registerAuthRoutes(router, dependencies);
  registerAdminRoutes(router, dependencies);

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const match = router.match(request.method, url.pathname);

    try {
      if (match) {
        const context = createRequestContext(request, response, url, match.params, dependencies);
        await match.handler(context);
        return;
      }

      const context = createRequestContext(request, response, url, {}, dependencies);
      await staticHandler(context);
    } catch (error) {
      if (isAppError(error)) {
        const headers = {};
        if (error.statusCode === 429 && error.details?.retryAfterMs) {
          headers["Retry-After"] = String(Math.max(1, Math.ceil(error.details.retryAfterMs / 1000)));
        }

        sendJson(
          response,
          config,
          error.statusCode,
          {
            message: error.message,
            details: error.details
          },
          headers
        );
        return;
      }

      console.error("[alma] unhandled error:", error);
      sendJson(response, config, 500, {
        message: "Server encountered an unexpected error."
      });
    }
  });
};

const startServer = async () => {
  const server = await createApp();

  await new Promise((resolve) => {
    server.listen(config.server.port, config.server.host, resolve);
  });

  console.log(`[alma] server running at http://${config.server.host}:${config.server.port}`);
  return server;
};

module.exports = {
  createApp,
  startServer
};
