import { bootstrapApp } from "./front-app.js";

bootstrapApp().catch((error) => {
  console.error("[alma] failed to bootstrap frontend:", error);
});
