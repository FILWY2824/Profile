import { api } from "./front-api.js";
import { createAuthController } from "./front-auth.js";
import { createDefaultPortalConfig, ROLE_LABELS } from "./front-config.js";
import { createPortalRenderer } from "./front-portal.js";

const getElement = (selector) => document.querySelector(selector);

const ROLE_STATUS_COPY = {
  guest: {
    title: "访客模式",
    access: "基础浏览"
  },
  normal: {
    title: "已登录用户",
    access: "用户权限"
  },
  member: {
    title: "高频使用",
    access: "会员权限"
  },
  admin: {
    title: "系统管理",
    access: "管理员权限"
  }
};

const createCooldownController = (button, initialLabel) => {
  let timerId = null;

  const setLabel = (text) => {
    button.textContent = text;
  };

  const reset = () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }

    button.disabled = false;
    setLabel(initialLabel);
  };

  const start = (seconds = 60) => {
    let remaining = seconds;

    if (timerId) {
      clearInterval(timerId);
    }

    button.disabled = true;
    setLabel(`重新发送（${remaining}s）`);

    timerId = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        clearInterval(timerId);
        timerId = null;
        button.disabled = false;
        setLabel("重新发送验证码");
        return;
      }

      setLabel(`重新发送（${remaining}s）`);
    }, 1000);
  };

  return {
    reset,
    start
  };
};

const updateDocumentMeta = (portal) => {
  document.title = `${portal.site.title} | ${portal.site.brandTag}`;

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute(
      "content",
      `${portal.site.title}是一个面向 AI 时代的个人服务中枢，用于组织知识、工具、服务与协作效率。`
    );
  }
};

const getAvatarText = (username) => {
  const value = String(username || "").trim();
  return value ? value.slice(0, 1).toUpperCase() : "栖";
};

export const bootstrapApp = async () => {
  const elements = {
    nav: getElement("#section-nav"),
    rows: getElement("#section-rows"),
    authStatus: getElement("#auth-status"),
    roleBadge: getElement("#role-badge"),
    displayName: getElement("#display-name"),
    accountEmail: getElement("#account-email"),
    accountAvatar: getElement("#account-avatar"),
    accountStatusTitle: getElement("#account-status-title"),
    accountAccessLevel: getElement("#account-access-level"),
    openAdminLink: getElement("#open-admin-link"),
    openLoginButton: getElement("#open-login-button"),
    openRegisterButton: getElement("#open-register-button"),
    openForgotPasswordButton: getElement("#open-forgot-password-button"),
    logoutButton: getElement("#logout-button"),
    profileButton: getElement("#open-profile-button"),
    brandTag: getElement("#brand-tag"),
    heroTitle: getElement("#hero-title"),
    heroLead: getElement("#hero-lead"),
    authNote: getElement("#auth-note")
  };

  const templates = {
    nav: getElement("#nav-template"),
    section: getElement("#section-template"),
    module: getElement("#module-template")
  };

  const authElements = {
    modal: getElement("#auth-modal"),
    closeButton: getElement("#close-auth-modal"),
    title: getElement("#auth-title"),
    message: getElement("#auth-message"),
    tabs: getElement(".auth-switch"),
    tabLogin: getElement("#tab-login"),
    tabRegister: getElement("#tab-register"),
    openResetInline: getElement("#open-reset-inline"),
    backToLoginInline: getElement("#back-to-login-inline"),
    loginForm: getElement("#login-form"),
    registerForm: getElement("#register-form"),
    resetForm: getElement("#reset-form"),
    loginAccount: getElement("#login-account"),
    loginPassword: getElement("#login-password"),
    registerUsername: getElement("#register-username"),
    registerEmail: getElement("#register-email"),
    registerPassword: getElement("#register-password"),
    registerCode: getElement("#register-code"),
    resetEmail: getElement("#reset-email"),
    resetCode: getElement("#reset-code"),
    resetPassword: getElement("#reset-password"),
    sendRegisterCodeButton: getElement("#send-register-code-button"),
    sendResetCodeButton: getElement("#send-reset-code-button")
  };

  const profileElements = {
    modal: getElement("#profile-modal"),
    closeButton: getElement("#close-profile-modal"),
    form: getElement("#profile-form"),
    username: getElement("#profile-username"),
    email: getElement("#profile-email"),
    toggleEmailEditButton: getElement("#toggle-email-edit-button"),
    emailVerificationPanel: getElement("#profile-email-verification"),
    emailCode: getElement("#profile-email-code"),
    sendEmailCodeButton: getElement("#send-email-code-button"),
    currentPassword: getElement("#profile-current-password"),
    newPassword: getElement("#profile-new-password"),
    forgotPasswordButton: getElement("#open-reset-from-profile"),
    message: getElement("#profile-message")
  };

  const portalRenderer = createPortalRenderer({
    navContainer: elements.nav,
    rowsContainer: elements.rows,
    templates
  });

  const emailChangeCooldown = createCooldownController(
    profileElements.sendEmailCodeButton,
    "发送验证码"
  );

  let currentUser = null;
  let portal = createDefaultPortalConfig();
  let emailEditing = false;

  const setProfileMessage = (message, type = "success") => {
    if (!message) {
      profileElements.message.textContent = "";
      profileElements.message.className = "inline-feedback hidden";
      return;
    }

    profileElements.message.textContent = message;
    profileElements.message.className = `inline-feedback is-${type}`;
  };

  const applyEmailEditState = () => {
    const isReadonly = !emailEditing;
    profileElements.email.readOnly = isReadonly;
    profileElements.email.classList.toggle("is-readonly", isReadonly);
    profileElements.emailVerificationPanel.classList.toggle("hidden", isReadonly);
    profileElements.toggleEmailEditButton.textContent = isReadonly ? "修改邮箱" : "取消修改";
    profileElements.toggleEmailEditButton.classList.toggle("is-active", emailEditing);

    if (isReadonly && currentUser) {
      profileElements.email.value = currentUser.email || "";
      profileElements.emailCode.value = "";
      emailChangeCooldown.reset();
    }
  };

  const closeProfileModal = () => {
    profileElements.modal.classList.add("hidden");
    profileElements.modal.setAttribute("aria-hidden", "true");
    profileElements.form.reset();
    emailEditing = false;
    applyEmailEditState();
    setProfileMessage("");
  };

  const openProfileModal = () => {
    if (!currentUser) {
      authController.open("login");
      return;
    }

    profileElements.username.value = currentUser.username || "";
    profileElements.email.value = currentUser.email || "";
    profileElements.emailCode.value = "";
    profileElements.currentPassword.value = "";
    profileElements.newPassword.value = "";
    emailEditing = false;
    applyEmailEditState();
    setProfileMessage("");
    profileElements.modal.classList.remove("hidden");
    profileElements.modal.setAttribute("aria-hidden", "false");
  };

  const openResetFlow = () => {
    closeProfileModal();
    authController.open("reset", {
      prefillEmail: currentUser?.email || ""
    });
  };

  const updateSiteCopy = () => {
    elements.brandTag.textContent = portal.site.brandTag || "QISHU SERVICE OS";
    elements.heroTitle.textContent = portal.site.title || "栖枢";
    elements.heroLead.textContent =
      portal.site.lead ||
      "把知识、工具、服务与协作能力聚拢为一座个人中枢。借助 AI 与云端部署，一个人也可以像一支团队那样持续学习、快速开发、稳定交付。";
    elements.authNote.textContent =
      portal.site.authNote || "支持邮箱注册、验证码验证、资料维护与分级访问控制。";
    elements.openAdminLink.textContent = portal.site.adminEntryLabel || "进入控制台";
    updateDocumentMeta(portal);
  };

  const updateAuthUI = () => {
    const role = currentUser?.role ?? "guest";
    const username = currentUser?.username ?? "Guest";
    const roleCopy = ROLE_STATUS_COPY[role];
    const summary = portalRenderer.getSummary(portal, currentUser);

    elements.roleBadge.textContent = ROLE_LABELS[role];
    elements.roleBadge.className = `role-badge role-${role}`;
    elements.displayName.textContent = username;
    elements.accountAvatar.textContent = getAvatarText(currentUser?.username);
    elements.accountStatusTitle.textContent = roleCopy.title;
    elements.accountAccessLevel.textContent = `${roleCopy.access} · ${summary.accessibleModules} 个可访问模块`;

    if (!currentUser) {
      elements.authStatus.textContent = "登录后可修改资料、找回密码，并按角色自动开放对应模块。";
      elements.accountEmail.textContent = "未登录";
      elements.profileButton.classList.add("is-disabled");
      elements.profileButton.setAttribute("aria-disabled", "true");
      elements.profileButton.setAttribute("title", "点击登录账号");
      elements.openLoginButton.classList.remove("hidden");
      elements.openRegisterButton.classList.remove("hidden");
      elements.logoutButton.classList.add("hidden");
      elements.openAdminLink.classList.add("hidden");
      return;
    }

    elements.authStatus.textContent = "点击个人卡片即可修改资料；修改邮箱时，需要先向新邮箱发送验证码并完成校验。";
    elements.accountEmail.textContent = currentUser.email || "未设置邮箱";
    elements.profileButton.classList.remove("is-disabled");
    elements.profileButton.removeAttribute("aria-disabled");
    elements.profileButton.setAttribute("title", "点击修改个人资料");
    elements.openLoginButton.classList.add("hidden");
    elements.openRegisterButton.classList.add("hidden");
    elements.logoutButton.classList.remove("hidden");
    elements.openAdminLink.classList.toggle("hidden", role !== "admin");
  };

  const renderApp = () => {
    updateSiteCopy();
    portalRenderer.render(portal, currentUser);
    updateAuthUI();
  };

  const loadPortal = async () => {
    try {
      const response = await api.getPortalConfig();
      portal = response.portal;
    } catch {
      portal = createDefaultPortalConfig();
    }
  };

  const loadCurrentUser = async () => {
    try {
      const response = await api.getCurrentUser();
      currentUser = response.user || null;
    } catch {
      currentUser = null;
    }
  };

  const authController = createAuthController({
    elements: authElements,
    onSignedIn: async () => {
      await Promise.all([loadPortal(), loadCurrentUser()]);
      renderApp();
    },
    onSignedOut: async () => {
      currentUser = null;
      renderApp();
    }
  });

  elements.openLoginButton.addEventListener("click", () => authController.open("login"));
  elements.openRegisterButton.addEventListener("click", () => authController.open("register"));
  elements.openForgotPasswordButton.addEventListener("click", openResetFlow);
  elements.profileButton.addEventListener("click", openProfileModal);

  profileElements.closeButton.addEventListener("click", closeProfileModal);
  profileElements.forgotPasswordButton.addEventListener("click", openResetFlow);
  profileElements.toggleEmailEditButton.addEventListener("click", () => {
    emailEditing = !emailEditing;
    applyEmailEditState();

    if (emailEditing) {
      window.setTimeout(() => profileElements.email.focus(), 0);
    }

    setProfileMessage("");
  });

  profileElements.sendEmailCodeButton.addEventListener("click", async () => {
    if (!currentUser) {
      authController.open("login");
      return;
    }

    const nextEmail = profileElements.email.value.trim();
    if (!emailEditing) {
      setProfileMessage("请先开启邮箱修改。", "error");
      return;
    }

    if (!nextEmail) {
      setProfileMessage("请输入新的邮箱地址。", "error");
      return;
    }

    if (nextEmail === currentUser.email) {
      setProfileMessage("新邮箱不能与当前邮箱相同。", "error");
      return;
    }

    profileElements.sendEmailCodeButton.disabled = true;
    try {
      const response = await api.requestEmailChangeCode({
        email: nextEmail
      });
      setProfileMessage(response.message, "success");
      emailChangeCooldown.start(60);
    } catch (error) {
      setProfileMessage(error.message, "error");
      emailChangeCooldown.reset();
    } finally {
      if (!profileElements.sendEmailCodeButton.textContent.includes("重新发送")) {
        profileElements.sendEmailCodeButton.disabled = false;
      }
    }
  });

  profileElements.modal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeProfile === "true") {
      closeProfileModal();
    }
  });

  profileElements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = profileElements.form.querySelector(".form-submit");
    submitButton.disabled = true;

    try {
      const nextEmail = profileElements.email.value.trim();
      const emailChanged = Boolean(currentUser) && nextEmail !== currentUser.email;
      const payload = {
        username: profileElements.username.value.trim(),
        email: nextEmail,
        currentPassword: profileElements.currentPassword.value,
        newPassword: profileElements.newPassword.value
      };

      if (emailChanged) {
        payload.emailCode = profileElements.emailCode.value.trim();
      }

      const response = await api.updateProfile(payload);
      currentUser = response.user;
      renderApp();
      setProfileMessage(response.message, "success");
      window.setTimeout(closeProfileModal, 700);
    } catch (error) {
      setProfileMessage(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  elements.logoutButton.addEventListener("click", async () => {
    elements.logoutButton.disabled = true;
    try {
      await api.logout();
      currentUser = null;
      renderApp();
    } finally {
      elements.logoutButton.disabled = false;
    }
  });

  await Promise.all([loadPortal(), loadCurrentUser()]);
  renderApp();
};
