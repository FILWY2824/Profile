const registerHealthRoute = (router, dependencies) => {
  const { config, mailService, store } = dependencies;

  router.add("GET", "/api/health", async (context) => {
    context.json(200, {
      status: "ok",
      app: config.app,
      env: config.env,
      ...store.getDiagnostics(),
      mail: mailService.getStatus(),
      uptimeSeconds: Math.round(process.uptime())
    });
  });
};

module.exports = {
  registerHealthRoute
};
