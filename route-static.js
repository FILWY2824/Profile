const fs = require("fs/promises");
const path = require("path");
const { AppError } = require("./lib-errors");
const { sendContent } = require("./lib-http");

const PUBLIC_FILES = new Set([
  "/",
  "/index.html",
  "/about.html",
  "/admin.html",
  "/styles.css",
  "/about-page.css",
  "/styles-base.css",
  "/styles-layout.css",
  "/styles-components.css",
  "/admin-console.css",
  "/script.js",
  "/admin-page.js",
  "/front-app.js",
  "/front-api.js",
  "/front-auth.js",
  "/front-admin.js",
  "/front-portal.js",
  "/front-config.js",
  "/brand-mark.svg"
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const createStaticRouteHandler = (config) => {
  const rootDir = config.paths.rootDir;

  return async (context) => {
    if (context.request.method !== "GET" && context.request.method !== "HEAD") {
      throw new AppError(405, "Method not allowed for this resource.");
    }

    const requestedPath = context.pathname === "/" ? "/index.html" : context.pathname;
    if (!PUBLIC_FILES.has(requestedPath)) {
      throw new AppError(404, "Resource not found.");
    }

    const fullPath = path.join(rootDir, requestedPath.replace(/^\//u, ""));
    const extension = path.extname(fullPath).toLowerCase();
    const isHtml = extension === ".html";

    let body;
    try {
      body = await fs.readFile(fullPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new AppError(404, "Resource not found.");
      }
      throw error;
    }

    sendContent(context.response, config, 200, body, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": isHtml
        ? "no-cache"
        : `public, max-age=${config.http.staticAssetMaxAgeSeconds}`
    });
  };
};

module.exports = {
  createStaticRouteHandler
};
