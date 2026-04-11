const { startServer } = require("./server-app");

if (require.main === module) {
  startServer().catch((error) => {
    console.error("[alma] failed to start server:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer
};
