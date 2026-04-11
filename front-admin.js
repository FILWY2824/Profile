import { ROLE_LABELS, USER_STATUS_LABELS } from "./front-config.js";

export const formatDate = (value) => {
  if (!value) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

export const setInlineFeedback = (element, message, type = "success") => {
  if (!message) {
    element.textContent = "";
    element.className = "inline-feedback hidden";
    return;
  }

  element.textContent = message;
  element.className = `inline-feedback is-${type}`;
};

export const buildUserMeta = (user) =>
  `${user.email} | ${ROLE_LABELS[user.role]} | ${USER_STATUS_LABELS[user.status]} | 最近登录 ${formatDate(
    user.lastLoginAt
  )}`;
