const { AppError } = require("./lib-errors");

const buildSecurityHeaders = (config) => ({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": config.security.contentSecurityPolicy
});

const buildResponseHeaders = (config, headers = {}) => ({
  ...buildSecurityHeaders(config),
  ...headers
});

const sendJson = (response, config, statusCode, payload, headers = {}) => {
  response.writeHead(
    statusCode,
    buildResponseHeaders(config, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    })
  );
  response.end(JSON.stringify(payload));
};

const sendContent = (response, config, statusCode, content, headers = {}) => {
  response.writeHead(statusCode, buildResponseHeaders(config, headers));
  response.end(content);
};

const sendRedirect = (response, config, location, statusCode = 302) => {
  response.writeHead(
    statusCode,
    buildResponseHeaders(config, {
      Location: location,
      "Cache-Control": "no-store"
    })
  );
  response.end();
};

const readJsonBody = async (request, maxBodyBytes) => {
  const chunks = [];
  let totalLength = 0;

  for await (const chunk of request) {
    totalLength += chunk.length;
    if (totalLength > maxBodyBytes) {
      throw new AppError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Request body must be valid JSON.");
  }
};

const getClientIp = (request, trustProxy = false) => {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
  }

  return request.socket.remoteAddress || "unknown";
};

module.exports = {
  buildResponseHeaders,
  getClientIp,
  readJsonBody,
  sendContent,
  sendJson,
  sendRedirect
};
