const { sendRedirect } = require("./lib-http");

const registerPortalRoutes = (router, dependencies) => {
  const { portalService, sessionService } = dependencies;

  router.add("GET", "/api/portal/config", async (context) => {
    context.json(200, {
      portal: portalService.getPublicPortalConfig()
    });
  });

  router.add("GET", "/go/:moduleKey", async (context) => {
    try {
      const user = sessionService.getCurrentUser(context.request);
      const target = portalService.resolveModuleTarget(context.params.moduleKey, user);
      sendRedirect(context.response, context.config, target, 302);
    } catch {
      sendRedirect(context.response, context.config, "/index.html", 302);
    }
  });
};

module.exports = {
  registerPortalRoutes
};
