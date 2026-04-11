const { parseCookies, serializeCookie } = require("./lib-cookies");
const { createToken, hashValue } = require("./lib-crypto");

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

const createSessionService = ({ config, store }) => {
  const cookieOptions = {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: config.security.secureCookies
  };

  const setSessionCookie = (response, token) => {
    response.setHeader(
      "Set-Cookie",
      serializeCookie(config.security.cookieName, token, {
        ...cookieOptions,
        maxAge: Math.floor(config.security.sessionMaxAgeMs / 1000)
      })
    );
  };

  const clearSessionCookie = (response) => {
    response.setHeader(
      "Set-Cookie",
      serializeCookie(config.security.cookieName, "", {
        ...cookieOptions,
        maxAge: 0
      })
    );
  };

  const getSessionContext = (request) => {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[config.security.cookieName];

    if (!token) {
      return null;
    }

    return store.getSessionContext(hashValue(token));
  };

  const getCurrentUser = (request) => {
    const context = getSessionContext(request);
    if (!context?.user || context.user.status !== "active") {
      return null;
    }

    return sanitizeUser(context.user);
  };

  const issueSession = async (response, userId) => {
    const rawToken = createToken();
    const expiresAt = new Date(Date.now() + config.security.sessionMaxAgeMs).toISOString();

    await store.createSession({
      userId,
      tokenHash: hashValue(rawToken),
      expiresAt
    });

    setSessionCookie(response, rawToken);
  };

  const destroyCurrentSession = async (request, response) => {
    const context = getSessionContext(request);
    if (context?.session) {
      await store.deleteSession(context.session.id);
    }

    clearSessionCookie(response);
  };

  return {
    clearSessionCookie,
    destroyCurrentSession,
    getCurrentUser,
    issueSession
  };
};

module.exports = {
  createSessionService
};
