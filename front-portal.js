import { ROLE_LABELS, ROLE_LEVELS } from "./front-config.js";

const hasRoleAccess = (requiredRole, user) => {
  const activeRole = user?.role ?? "guest";
  return ROLE_LEVELS[activeRole] >= ROLE_LEVELS[requiredRole];
};

const isItemAccessible = (item, user) =>
  item.enabled !== false && hasRoleAccess(item.requiredRole, user);

const getStateText = (item, user) => {
  if (item.enabled === false) {
    return "已关闭";
  }

  if (isItemAccessible(item, user)) {
    return item.requiredRole === "admin" ? "管理员可用" : "可访问";
  }

  return `需 ${ROLE_LABELS[item.requiredRole]} 权限`;
};

const countAccessibleModules = (portal, user) =>
  portal.sections.reduce(
    (sum, section) => sum + section.items.filter((item) => isItemAccessible(item, user)).length,
    0
  );

export const createPortalRenderer = ({ navContainer, rowsContainer, templates }) => {
  const render = (portal, user) => {
    navContainer.innerHTML = "";
    rowsContainer.innerHTML = "";

    portal.sections.forEach((section, sectionIndex) => {
      const navNode = templates.nav.content.cloneNode(true);
      const navChip = navNode.querySelector(".nav-chip");
      navChip.href = `#${section.id}`;
      navChip.textContent = section.title;
      navContainer.appendChild(navNode);

      const sectionNode = templates.section.content.cloneNode(true);
      const zone = sectionNode.querySelector(".zone-section");
      const kicker = sectionNode.querySelector(".zone-kicker");
      const title = sectionNode.querySelector(".zone-title");
      const count = sectionNode.querySelector(".zone-count");
      const moduleGrid = sectionNode.querySelector(".module-grid");

      zone.id = section.id;
      zone.style.setProperty("--zone-accent", section.accent);
      zone.style.setProperty("--zone-glow", section.glow);
      zone.style.setProperty("--section-delay", `${120 + sectionIndex * 90}ms`);

      kicker.textContent = section.tag;
      title.textContent = section.title;
      count.textContent = `${section.items.length} 个模块`;

      section.items.forEach((item, itemIndex) => {
        const moduleNode = templates.module.content.cloneNode(true);
        const moduleCard = moduleNode.querySelector(".module-card");
        const glyph = moduleNode.querySelector(".module-glyph");
        const name = moduleNode.querySelector(".module-name");
        const badge = moduleNode.querySelector(".module-badge");
        const summary = moduleNode.querySelector(".module-summary");
        const state = moduleNode.querySelector(".module-state");
        const action = moduleNode.querySelector(".module-action");

        const allowed = isItemAccessible(item, user);
        const entryPath = item.entryPath || `/go/${encodeURIComponent(item.key)}`;

        moduleCard.style.setProperty("--zone-accent", section.accent);
        moduleCard.style.setProperty("--zone-accent-deep", section.accentDeep);
        moduleCard.style.setProperty("--zone-shadow", section.shadow);
        moduleCard.style.setProperty("--card-delay", `${220 + sectionIndex * 80 + itemIndex * 70}ms`);
        moduleCard.classList.toggle("is-locked", !allowed);

        glyph.textContent = item.glyph;
        name.textContent = item.name;
        badge.textContent = item.badge;
        summary.textContent = item.summary;
        state.textContent = getStateText(item, user);

        if (allowed) {
          name.href = entryPath;
          name.setAttribute("aria-label", `打开 ${item.name}`);
          action.href = entryPath;
          action.textContent = "进入";
          action.classList.remove("is-disabled");
          action.removeAttribute("aria-disabled");
          action.setAttribute("aria-label", `进入 ${item.name}`);
          state.classList.add("is-open");
          state.classList.remove("is-locked");
        } else {
          name.removeAttribute("href");
          name.setAttribute("aria-disabled", "true");
          action.removeAttribute("href");
          action.textContent = item.enabled === false ? "已关闭" : "已上锁";
          action.classList.add("is-disabled");
          action.setAttribute("aria-disabled", "true");
          state.classList.add("is-locked");
          state.classList.remove("is-open");
        }

        moduleGrid.appendChild(moduleNode);
      });

      rowsContainer.appendChild(sectionNode);
    });
  };

  const getSummary = (portal, user) => ({
    totalModules: portal.sections.reduce((sum, section) => sum + section.items.length, 0),
    totalSections: portal.sections.length,
    accessibleModules: countAccessibleModules(portal, user)
  });

  return {
    getSummary,
    render
  };
};
