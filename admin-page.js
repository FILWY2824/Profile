import { api } from "./front-api.js";
import { buildUserMeta, formatDate, setInlineFeedback } from "./front-admin.js";
import { ROLE_LABELS, USER_STATUS_LABELS, createDefaultPortalConfig } from "./front-config.js";

const getElement = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const countPortalModules = (portal) => portal.sections.reduce((sum, section) => sum + section.items.length, 0);
const countDisabledModules = (portal) =>
  portal.sections.reduce(
    (sum, section) => sum + section.items.filter((item) => item.enabled === false).length,
    0
  );
const countSuspendedUsers = (users) => users.filter((user) => user.status === "suspended").length;

const createOptionMarkup = (options, selected) =>
  options
    .map(
      (option) =>
        `<option value="${option.value}"${option.value === selected ? " selected" : ""}>${option.label}</option>`
    )
    .join("");

const createModuleCardMarkup = (item, sectionTitle) => `
  <article class="module-control-card glass-card" data-module-key="${escapeHtml(item.key)}">
    <div class="module-control-head">
      <div>
        <p class="summary-label">${escapeHtml(sectionTitle)}</p>
        <h3>${escapeHtml(item.name)}</h3>
      </div>
      <div class="module-control-tools">
        <span class="status-badge ${item.enabled === false ? "status-off" : "status-on"}">
          ${item.enabled === false ? "已关闭" : "运行中"}
        </span>
      </div>
    </div>
    <div class="module-control-grid">
      <label class="field settings-wide">
        <span>受控跳转目标</span>
        <input class="module-url-input" type="url" value="${escapeHtml(item.url)}" maxlength="2048" required />
      </label>
      <label class="field">
        <span>最小访问角色</span>
        <select class="module-role-select">
          ${createOptionMarkup(
            [
              { value: "guest", label: "访客" },
              { value: "normal", label: "普通" },
              { value: "member", label: "会员" },
              { value: "admin", label: "管理员" }
            ],
            item.requiredRole
          )}
        </select>
      </label>
      <label class="checkbox-row">
        <input class="module-enabled-toggle" type="checkbox"${item.enabled === false ? "" : " checked"} />
        <span>模块开放</span>
      </label>
    </div>
  </article>
`;

const createUserCardMarkup = (user, currentUserId) => `
  <article class="admin-user-card glass-card" data-user-id="${escapeHtml(user.id)}">
    <div class="admin-user-head">
      <div>
        <h3 class="admin-user-name">${escapeHtml(user.displayName)} @${escapeHtml(user.username)}</h3>
        <p class="admin-user-meta">${escapeHtml(buildUserMeta(user))}</p>
      </div>
      <div class="user-tag-stack">
        <span class="role-badge role-${user.role}">${ROLE_LABELS[user.role]}</span>
        <span class="status-badge ${user.status === "active" ? "status-on" : "status-off"}">
          ${USER_STATUS_LABELS[user.status]}
        </span>
      </div>
    </div>
    <div class="user-detail-list">
      <span><strong>ID</strong> ${escapeHtml(user.id)}</span>
      <span><strong>邮箱</strong> ${escapeHtml(user.email)}</span>
      <span><strong>创建时间</strong> ${escapeHtml(formatDate(user.createdAt))}</span>
      <span><strong>最近登录</strong> ${escapeHtml(formatDate(user.lastLoginAt))}</span>
    </div>
    <div class="admin-user-body">
      <div class="user-edit-grid">
        <label class="field">
          <span>角色</span>
          <select class="admin-role-select">
            ${createOptionMarkup(
              [
                { value: "normal", label: "普通" },
                { value: "member", label: "会员" },
                { value: "admin", label: "管理员" }
              ],
              user.role
            )}
          </select>
        </label>
        <label class="field">
          <span>账号状态</span>
          <select class="admin-status-select">
            ${createOptionMarkup(
              [
                { value: "active", label: "正常" },
                { value: "suspended", label: "停用" }
              ],
              user.status
            )}
          </select>
        </label>
      </div>
      <div class="stack-actions">
        <button class="secondary-button save-user-button" type="button">保存账号配置</button>
        <button class="ghost-button delete-user-button" type="button"${
          user.id === currentUserId ? " disabled" : ""
        }>删除账号</button>
      </div>
    </div>
  </article>
`;

const bootstrapAdminPage = async () => {
  const elements = {
    overviewSection: getElement("#admin-overview"),
    main: getElement("#admin-main"),
    emptyState: getElement("#admin-empty-state"),
    refreshButton: getElement("#refresh-console-button"),
    overviewIdentity: getElement("#overview-identity"),
    overviewEmail: getElement("#overview-email"),
    overviewModules: getElement("#overview-modules"),
    overviewDisabled: getElement("#overview-disabled"),
    overviewSuspended: getElement("#overview-suspended"),
    siteForm: getElement("#site-settings-form"),
    siteBrandTag: getElement("#site-brand-tag"),
    siteAdminEntryLabel: getElement("#site-admin-entry-label"),
    siteTitle: getElement("#site-title"),
    siteLead: getElement("#site-lead"),
    siteSummaryNote: getElement("#site-summary-note"),
    siteAuthNote: getElement("#site-auth-note"),
    saveSiteButton: getElement("#save-site-settings-button"),
    siteFeedback: getElement("#site-feedback"),
    saveModuleButton: getElement("#save-module-settings-button"),
    moduleControls: getElement("#module-controls"),
    moduleFeedback: getElement("#module-feedback"),
    userSearchInput: getElement("#user-search-input"),
    userList: getElement("#user-list"),
    userFeedback: getElement("#user-feedback"),
    runtimeForm: getElement("#runtime-config-form"),
    runtimeFeedback: getElement("#runtime-feedback"),
    saveRuntimeButton: getElement("#save-runtime-config-button"),
    configResendApiKeyStatus: getElement("#config-resend-api-key-status")
  };

  const runtimeFields = {
    APP_NAME: getElement("#config-app-name"),
    APP_VERSION: getElement("#config-app-version"),
    HOST: getElement("#config-host"),
    PORT: getElement("#config-port"),
    TRUST_PROXY: getElement("#config-trust-proxy"),
    MAX_BODY_BYTES: getElement("#config-max-body"),
    STATIC_ASSET_MAX_AGE_SECONDS: getElement("#config-static-age"),
    SESSION_COOKIE_NAME: getElement("#config-session-cookie"),
    SESSION_MAX_AGE_MS: getElement("#config-session-max-age"),
    SECURE_COOKIES: getElement("#config-secure-cookies"),
    VERIFICATION_TTL_MS: getElement("#config-verification-ttl"),
    VERIFICATION_CODE_LENGTH: getElement("#config-verification-length"),
    MAX_VERIFICATION_ATTEMPTS: getElement("#config-verification-attempts"),
    PASSWORD_MIN_LENGTH: getElement("#config-password-min"),
    PASSWORD_MAX_LENGTH: getElement("#config-password-max"),
    MAX_SESSIONS_PER_USER: getElement("#config-max-sessions"),
    RATE_LIMIT_LOGIN_WINDOW_MS: getElement("#config-login-window"),
    RATE_LIMIT_LOGIN_MAX: getElement("#config-login-max"),
    RATE_LIMIT_VERIFY_REQUEST_WINDOW_MS: getElement("#config-verify-request-window"),
    RATE_LIMIT_VERIFY_REQUEST_MAX: getElement("#config-verify-request-max"),
    RATE_LIMIT_VERIFY_CHECK_WINDOW_MS: getElement("#config-verify-check-window"),
    RATE_LIMIT_VERIFY_CHECK_MAX: getElement("#config-verify-check-max"),
    RATE_LIMIT_ADMIN_WINDOW_MS: getElement("#config-admin-window"),
    RATE_LIMIT_ADMIN_MAX: getElement("#config-admin-max"),
    MAIL_FROM: getElement("#config-mail-from"),
    MAIL_REPLY_TO: getElement("#config-mail-reply-to"),
    RESEND_API_KEY: getElement("#config-resend-api-key"),
    MAIL_DEV_LOG_CODES: getElement("#config-mail-log-codes")
  };

  let currentUser = null;
  let portal = createDefaultPortalConfig();
  let users = [];
  let runtimeConfig = null;
  let userQuery = "";

  const renderOverview = () => {
    elements.overviewIdentity.textContent = currentUser?.displayName || "-";
    elements.overviewEmail.textContent = currentUser?.email || "-";
    elements.overviewModules.textContent = String(countPortalModules(portal));
    elements.overviewDisabled.textContent = String(countDisabledModules(portal));
    elements.overviewSuspended.textContent = String(countSuspendedUsers(users));
  };

  const renderSiteForm = () => {
    elements.siteBrandTag.value = portal.site.brandTag;
    elements.siteAdminEntryLabel.value = portal.site.adminEntryLabel;
    elements.siteTitle.value = portal.site.title;
    elements.siteLead.value = portal.site.lead;
    elements.siteSummaryNote.value = portal.site.summaryNote;
    elements.siteAuthNote.value = portal.site.authNote;
  };

  const renderRuntimeConfig = () => {
    if (!runtimeConfig) {
      return;
    }

    Object.entries(runtimeFields).forEach(([key, element]) => {
      if (!element || key === "RESEND_API_KEY") {
        return;
      }

      if (element.type === "checkbox") {
        element.checked = Boolean(runtimeConfig[key]);
      } else {
        element.value = runtimeConfig[key] ?? "";
      }
    });

    runtimeFields.RESEND_API_KEY.value = "";
    elements.configResendApiKeyStatus.textContent = runtimeConfig.RESEND_API_KEY_SET
      ? "已配置 Resend Key"
      : "未配置 Resend Key";
    elements.configResendApiKeyStatus.className = `status-badge ${
      runtimeConfig.RESEND_API_KEY_SET ? "status-on" : "status-off"
    }`;
  };

  const renderModuleControls = () => {
    elements.moduleControls.innerHTML = portal.sections
      .flatMap((section) => section.items.map((item) => createModuleCardMarkup(item, section.title)))
      .join("");
  };

  const collectModuleSettings = () =>
    Array.from(elements.moduleControls.querySelectorAll(".module-control-card")).map((card) => ({
      key: card.dataset.moduleKey,
      url: card.querySelector(".module-url-input").value.trim(),
      requiredRole: card.querySelector(".module-role-select").value,
      enabled: card.querySelector(".module-enabled-toggle").checked
    }));

  const getFilteredUsers = () => {
    const query = userQuery.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) =>
      [user.username, user.displayName, user.email, user.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  };

  const bindUserActions = () => {
    elements.userList.querySelectorAll(".admin-user-card").forEach((card) => {
      const userId = card.dataset.userId;
      const saveButton = card.querySelector(".save-user-button");
      const deleteButton = card.querySelector(".delete-user-button");
      const roleSelect = card.querySelector(".admin-role-select");
      const statusSelect = card.querySelector(".admin-status-select");

      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        roleSelect.disabled = true;
        statusSelect.disabled = true;
        setInlineFeedback(elements.userFeedback, "");

        try {
          await api.updateAdminUser(userId, {
            role: roleSelect.value,
            status: statusSelect.value
          });

          await loadData();
          setInlineFeedback(elements.userFeedback, "用户配置已保存。", "success");
        } catch (error) {
          setInlineFeedback(elements.userFeedback, error.message, "error");
        } finally {
          saveButton.disabled = false;
          roleSelect.disabled = false;
          statusSelect.disabled = false;
        }
      });

      deleteButton.addEventListener("click", async () => {
        if (!window.confirm("确定要删除这个账号吗？该操作会立即清除该用户的会话。")) {
          return;
        }

        deleteButton.disabled = true;
        setInlineFeedback(elements.userFeedback, "");

        try {
          await api.deleteAdminUser(userId);
          await loadData();
          setInlineFeedback(elements.userFeedback, "用户已删除。", "success");
        } catch (error) {
          setInlineFeedback(elements.userFeedback, error.message, "error");
        } finally {
          deleteButton.disabled = false;
        }
      });
    });
  };

  const renderUsers = () => {
    const filteredUsers = getFilteredUsers();

    if (!filteredUsers.length) {
      elements.userList.innerHTML = `<div class="inline-feedback">没有匹配的用户。</div>`;
      return;
    }

    elements.userList.innerHTML = filteredUsers
      .map((user) => createUserCardMarkup(user, currentUser?.id ?? ""))
      .join("");

    bindUserActions();
  };

  const renderAll = () => {
    renderOverview();
    renderSiteForm();
    renderModuleControls();
    renderRuntimeConfig();
    renderUsers();
  };

  const showUnauthorized = () => {
    elements.overviewSection.classList.add("hidden");
    elements.main.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
  };

  const showConsole = () => {
    elements.overviewSection.classList.remove("hidden");
    elements.main.classList.remove("hidden");
    elements.emptyState.classList.add("hidden");
  };

  const loadData = async () => {
    try {
      const currentUserResponse = await api.getCurrentUser();
      currentUser = currentUserResponse.user;
    } catch {
      currentUser = null;
    }

    if (!currentUser || currentUser.role !== "admin") {
      showUnauthorized();
      return;
    }

    const [portalResponse, usersResponse, runtimeResponse] = await Promise.all([
      api.getAdminPortalConfig(),
      api.getAdminUsers(),
      api.getRuntimeConfig()
    ]);

    portal = portalResponse.portal;
    users = usersResponse.users;
    runtimeConfig = runtimeResponse.config;
    showConsole();
    renderAll();
  };

  document.querySelectorAll(".fold-action-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  elements.siteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.saveSiteButton.disabled = true;
    setInlineFeedback(elements.siteFeedback, "");

    try {
      const response = await api.updateSiteSettings({
        brandTag: elements.siteBrandTag.value.trim(),
        adminEntryLabel: elements.siteAdminEntryLabel.value.trim(),
        title: elements.siteTitle.value.trim(),
        lead: elements.siteLead.value.trim(),
        summaryNote: elements.siteSummaryNote.value.trim(),
        authNote: elements.siteAuthNote.value.trim()
      });

      portal = response.portal;
      renderAll();
      setInlineFeedback(elements.siteFeedback, "站点配置已保存。", "success");
    } catch (error) {
      setInlineFeedback(elements.siteFeedback, error.message, "error");
    } finally {
      elements.saveSiteButton.disabled = false;
    }
  });

  elements.saveSiteButton.addEventListener("click", () => {
    elements.siteForm.requestSubmit();
  });

  elements.saveModuleButton.addEventListener("click", async () => {
    elements.saveModuleButton.disabled = true;
    setInlineFeedback(elements.moduleFeedback, "");

    try {
      const response = await api.updateModuleSettingsBatch({
        modules: collectModuleSettings()
      });
      portal = response.portal;
      renderAll();
      setInlineFeedback(elements.moduleFeedback, "模块配置已保存。", "success");
    } catch (error) {
      setInlineFeedback(elements.moduleFeedback, error.message, "error");
    } finally {
      elements.saveModuleButton.disabled = false;
    }
  });

  elements.runtimeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.saveRuntimeButton.disabled = true;
    setInlineFeedback(elements.runtimeFeedback, "");

    try {
      const payload = {};

      Object.entries(runtimeFields).forEach(([key, element]) => {
        if (!element) {
          return;
        }

        if (element.type === "checkbox") {
          payload[key] = element.checked;
          return;
        }

        payload[key] = element.value.trim();
      });

      const response = await api.updateRuntimeConfig(payload);
      runtimeConfig = response.config;
      renderRuntimeConfig();
      setInlineFeedback(
        elements.runtimeFeedback,
        response.message || "配置文件已写入，建议重启服务使全部设置生效。",
        "success"
      );
    } catch (error) {
      setInlineFeedback(elements.runtimeFeedback, error.message, "error");
    } finally {
      elements.saveRuntimeButton.disabled = false;
    }
  });

  elements.saveRuntimeButton.addEventListener("click", () => {
    elements.runtimeForm.requestSubmit();
  });

  elements.userSearchInput.addEventListener("input", () => {
    userQuery = elements.userSearchInput.value;
    renderUsers();
  });

  elements.refreshButton.addEventListener("click", async () => {
    elements.refreshButton.disabled = true;
    try {
      await loadData();
      setInlineFeedback(elements.siteFeedback, "");
      setInlineFeedback(elements.moduleFeedback, "");
      setInlineFeedback(elements.runtimeFeedback, "");
      setInlineFeedback(elements.userFeedback, "后台数据已刷新。", "success");
    } catch (error) {
      setInlineFeedback(elements.userFeedback, error.message, "error");
    } finally {
      elements.refreshButton.disabled = false;
    }
  });

  await loadData();
};

bootstrapAdminPage().catch((error) => {
  console.error("[alma] failed to bootstrap admin page:", error);
});
