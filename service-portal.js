const { AppError } = require("./lib-errors");
const { createPortalDefaults, listModuleCatalog, VALID_ROLES } = require("./portal-defaults");

const MODULE_CATALOG = listModuleCatalog();
const MODULE_KEYS = new Set(MODULE_CATALOG.map((item) => item.key));
const ROLE_LEVELS = {
  guest: 0,
  normal: 1,
  member: 2,
  admin: 3
};

const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const hasRoleAccess = (requiredRole, user) => {
  const activeRole = user?.role || "guest";
  return ROLE_LEVELS[activeRole] >= ROLE_LEVELS[requiredRole];
};

const normalizeSitePatch = (payload) => {
  const patch = {};
  const fields = {
    brandTag: 40,
    title: 120,
    lead: 320,
    summaryNote: 220,
    authNote: 180,
    adminEntryLabel: 24
  };

  Object.entries(fields).forEach(([key, maxLength]) => {
    if (payload[key] === undefined) {
      return;
    }

    const value = String(payload[key] || "").trim();
    if (!value) {
      throw new AppError(400, `${key} 不能为空。`);
    }

    if (value.length > maxLength) {
      throw new AppError(400, `${key} 长度不能超过 ${maxLength} 个字符。`);
    }

    patch[key] = value;
  });

  if (!Object.keys(patch).length) {
    throw new AppError(400, "没有可更新的站点配置。");
  }

  return patch;
};

const normalizeModulePatch = (moduleKey, payload) => {
  if (!MODULE_KEYS.has(moduleKey)) {
    throw new AppError(404, "模块不存在。");
  }

  const patch = {};

  if (payload.enabled !== undefined) {
    patch.enabled = Boolean(payload.enabled);
  }

  if (payload.requiredRole !== undefined) {
    if (!VALID_ROLES.includes(payload.requiredRole)) {
      throw new AppError(400, "模块访问角色不合法。");
    }
    patch.requiredRole = payload.requiredRole;
  }

  if (payload.url !== undefined) {
    const url = String(payload.url || "").trim();
    if (!url || !isHttpUrl(url)) {
      throw new AppError(400, "模块地址必须是有效的 http 或 https 链接。");
    }
    if (url.length > 2048) {
      throw new AppError(400, "模块地址过长。");
    }
    patch.url = url;
  }

  if (!Object.keys(patch).length) {
    throw new AppError(400, "没有可更新的模块配置。");
  }

  return patch;
};

const normalizeModuleBatch = (payload) => {
  if (!payload || !Array.isArray(payload.modules) || !payload.modules.length) {
    throw new AppError(400, "没有可保存的模块配置。");
  }

  return payload.modules.map((item) => ({
    key: item.key,
    patch: normalizeModulePatch(item.key, item)
  }));
};

const mergePortalConfig = (storedSettings) => {
  const defaults = createPortalDefaults();
  const siteSettings = storedSettings?.site || {};
  const moduleSettings = storedSettings?.modules || {};

  defaults.site = {
    ...defaults.site,
    ...siteSettings
  };

  defaults.sections = defaults.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const overrides = moduleSettings[item.key] || {};
      return {
        ...item,
        ...overrides,
        enabled: overrides.enabled === undefined ? item.enabled !== false : Boolean(overrides.enabled)
      };
    })
  }));

  return defaults;
};

const sanitizePortalForPublic = (portal) => ({
  site: {
    ...portal.site
  },
  sections: portal.sections.map((section) => ({
    ...section,
    items: section.items.map(({ url, ...item }) => ({
      ...item,
      entryPath: `/go/${encodeURIComponent(item.key)}`
    }))
  }))
});

const findModule = (portal, moduleKey) =>
  portal.sections.flatMap((section) => section.items).find((item) => item.key === moduleKey) || null;

const createPortalService = ({ store }) => {
  const getMergedPortalConfig = () => mergePortalConfig(store.getPortalSettings());

  const getPublicPortalConfig = () => sanitizePortalForPublic(getMergedPortalConfig());

  const getAdminPortalConfig = () => getMergedPortalConfig();

  const resolveModuleTarget = (moduleKey, user) => {
    const portal = getMergedPortalConfig();
    const item = findModule(portal, moduleKey);

    if (!item) {
      throw new AppError(404, "模块不存在。");
    }

    if (item.enabled === false) {
      throw new AppError(403, "该模块当前已关闭。");
    }

    if (!hasRoleAccess(item.requiredRole, user)) {
      throw new AppError(403, "当前账号无权访问该模块。");
    }

    return item.url;
  };

  const updateSite = async (payload) => {
    const patch = normalizeSitePatch(payload);
    await store.updatePortalSite(patch);
    return {
      message: "站点配置已更新。",
      portal: getAdminPortalConfig()
    };
  };

  const updateModule = async (moduleKey, payload) => {
    const patch = normalizeModulePatch(moduleKey, payload);
    await store.updatePortalModule(moduleKey, patch);
    return {
      message: "模块配置已更新。",
      portal: getAdminPortalConfig()
    };
  };

  const updateModules = async (payload) => {
    const modules = normalizeModuleBatch(payload);
    await store.updatePortalModules(modules);
    return {
      message: "模块配置已更新。",
      portal: getAdminPortalConfig()
    };
  };

  return {
    getAdminPortalConfig,
    getPublicPortalConfig,
    resolveModuleTarget,
    updateModule,
    updateModules,
    updateSite
  };
};

module.exports = {
  createPortalService
};
