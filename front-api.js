class ApiError extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(payload?.message || "请求失败，请稍后再试。", response.status, payload?.details);
  }

  return payload;
};

const withJsonBody = (body, options = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(options.headers || {})
  },
  body: JSON.stringify(body),
  ...options
});

export const api = {
  getCurrentUser: () => requestJson("/api/auth/me"),
  getPortalConfig: () => requestJson("/api/portal/config"),
  getAdminPortalConfig: () => requestJson("/api/admin/portal"),
  getRuntimeConfig: () => requestJson("/api/admin/runtime-config"),
  getHealth: () => requestJson("/api/health"),
  login: (payload) => requestJson("/api/auth/login", withJsonBody(payload)),
  logout: () => requestJson("/api/auth/logout", { method: "POST" }),
  updateProfile: (payload) =>
    requestJson("/api/auth/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  requestRegisterCode: (payload) =>
    requestJson("/api/auth/request-register-code", withJsonBody(payload)),
  verifyRegisterCode: (payload) =>
    requestJson("/api/auth/verify-register-code", withJsonBody(payload)),
  requestPasswordReset: (payload) =>
    requestJson("/api/auth/request-password-reset", withJsonBody(payload)),
  resetPassword: (payload) => requestJson("/api/auth/reset-password", withJsonBody(payload)),
  requestEmailChangeCode: (payload) =>
    requestJson("/api/auth/request-email-change-code", withJsonBody(payload)),
  getAdminUsers: () => requestJson("/api/admin/users"),
  updateAdminUser: (userId, payload) =>
    requestJson(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  deleteAdminUser: (userId) =>
    requestJson(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE"
    }),
  updateSiteSettings: (payload) =>
    requestJson("/api/admin/portal/site", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  updateModuleSettings: (moduleKey, payload) =>
    requestJson(`/api/admin/portal/modules/${encodeURIComponent(moduleKey)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  updateModuleSettingsBatch: (payload) =>
    requestJson("/api/admin/portal/modules", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  updateRuntimeConfig: (payload) =>
    requestJson("/api/admin/runtime-config", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
};

export { ApiError };
