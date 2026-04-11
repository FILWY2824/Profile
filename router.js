const normalizePath = (pathname) => pathname.replace(/\/+$/u, "") || "/";

const matchPattern = (pattern, pathname) => {
  const patternSegments = normalizePath(pattern).split("/").filter(Boolean);
  const pathnameSegments = normalizePath(pathname).split("/").filter(Boolean);

  if (patternSegments.length !== pathnameSegments.length) {
    return null;
  }

  const params = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathnameSegments[index];

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }

    if (expected !== actual) {
      return null;
    }
  }

  return params;
};

const createRouter = () => {
  const routes = [];

  return {
    add(method, pattern, handler) {
      routes.push({
        method: method.toUpperCase(),
        pattern,
        handler
      });
    },
    match(method, pathname) {
      const targetMethod = method.toUpperCase();

      for (const route of routes) {
        if (route.method !== targetMethod) {
          continue;
        }

        const params = matchPattern(route.pattern, pathname);
        if (!params) {
          continue;
        }

        return {
          handler: route.handler,
          params
        };
      }

      return null;
    }
  };
};

module.exports = {
  createRouter
};
