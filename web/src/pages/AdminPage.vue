<template>
  <!-- 与 AccountPage 一致的两栏布局:左固定侧栏 + 右独立滚动主区。
       侧栏紧贴顶栏左缘对齐(由父 .app-shell.has-sidebar 控制全局滚动
       行为,这里 admin-shell 用 height:100% 占满父级 main 区域)。 -->
  <div class="admin-shell">
    <aside class="admin-sidebar hidden md:flex flex-col">
      <div class="admin-brand">
        <div class="admin-brand-name">管理后台</div>
        <div class="admin-brand-sub">ADMIN PANEL</div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3 space-y-5">
        <div>
          <div class="admin-group-label">概览</div>
          <button v-for="t in topTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
            {{ t.label }}
          </button>
        </div>
        <div>
          <div class="admin-group-label">内容</div>
          <button v-for="t in contentTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
            {{ t.label }}
          </button>
        </div>
        <div>
          <div class="admin-group-label">系统</div>
          <button v-for="t in systemTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
            {{ t.label }}
          </button>
        </div>
      </nav>
      <div class="admin-foot">{{ today }}</div>
    </aside>

    <!-- 移动端 tab -->
    <div class="admin-mobile-tabs md:hidden">
      <button v-for="t in [...topTabs, ...contentTabs, ...systemTabs]" :key="t.id"
              @click="active = t.id"
              :class="[
                'inline-flex items-center px-3 py-1.5 rounded-md text-xs mr-1 transition-colors whitespace-nowrap',
                active === t.id ? 'admin-mobile-tab-active' : 'text-fg-dim'
              ]">
        {{ t.label }}
      </button>
    </div>

    <!-- 主内容 — 独立滚动 -->
    <main class="admin-main">
      <div class="admin-main-inner">
        <component :is="activeView" />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";

import DashboardTab from "../components/admin/DashboardTab.vue";
import UsersTab from "../components/admin/UsersTab.vue";
import SectionsTab from "../components/admin/SectionsTab.vue";
import CardsTab from "../components/admin/CardsTab.vue";
import FaviconsTab from "../components/admin/FaviconsTab.vue";
import OAuthClientsTab from "../components/admin/OAuthClientsTab.vue";
import SettingsTab from "../components/admin/SettingsTab.vue";
import AuditTab from "../components/admin/AuditTab.vue";

const topTabs = [{ id: "dashboard", label: "总览" }];
const contentTabs = [
  { id: "sections", label: "板块" },
  { id: "cards",    label: "卡片" },
  { id: "favicons", label: "图标缓存" },
];
const systemTabs = [
  { id: "users",    label: "用户" },
  { id: "oauth",    label: "OAuth 客户端" },
  { id: "settings", label: "系统设置" },
  { id: "audit",    label: "审计日志" },
];

const active = ref("dashboard");
const map = {
  dashboard: DashboardTab,
  users: UsersTab,
  sections: SectionsTab,
  cards: CardsTab,
  favicons: FaviconsTab,
  oauth: OAuthClientsTab,
  settings: SettingsTab,
  audit: AuditTab,
};
const activeView = computed(() => map[active.value]);

const today = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
});
</script>

<style scoped>
.admin-shell {
  display: flex;
  height: 100%;
  width: 100%;
}

/* 侧边栏 — 固定宽度,自身可滚动(避免菜单很多时溢出) */
.admin-sidebar {
  width: 15rem;
  flex-shrink: 0;
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid rgba(15, 36, 25, 0.08);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.admin-brand {
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(15, 36, 25, 0.08);
}
.admin-brand-name {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.018em;
  color: var(--fg);
  line-height: 1;
}
.admin-brand-sub {
  font-size: 10px;
  color: var(--fg-mute);
  margin-top: 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.08em;
}

.admin-group-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--fg-mute);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0 12px;
  margin-bottom: 6px;
}

/* 侧边栏菜单项 — 去掉 emoji 图标,统一 12px 内边距 */
.admin-side-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  margin-bottom: 1px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-dim);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.admin-side-item:hover {
  background-color: rgba(255, 255, 255, 0.55);
  color: var(--fg);
}
.admin-side-item-active {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.55), rgba(110, 231, 183, 0.40));
  color: var(--brand-deep);
  font-weight: 600;
  border-color: rgba(110, 231, 183, 0.45);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.admin-side-item-active:hover {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.7), rgba(110, 231, 183, 0.55));
}

.admin-foot {
  border-top: 1px solid rgba(15, 36, 25, 0.08);
  padding: 12px 24px;
  font-size: 11px;
  color: var(--fg-mute);
  font-family: "JetBrains Mono", ui-monospace, monospace;
}

/* 主区 — 独立滚动 */
.admin-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
}
.admin-main-inner {
  max-width: 80rem;
  padding: 32px;
}
@media (max-width: 768px) {
  .admin-main-inner {
    padding: 16px;
  }
}

/* 移动端水平 tab — 仅在窄屏出现 */
.admin-mobile-tabs {
  position: sticky;
  top: 0;
  z-index: 20;
  margin: 12px 12px 0;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow-x: auto;
  white-space: nowrap;
  padding: 8px;
  box-shadow: 0 8px 24px -10px rgba(15, 36, 25, 0.10);
}
.admin-mobile-tab-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  color: #fff !important;
  font-weight: 600;
  box-shadow: 0 4px 10px -3px rgba(16, 185, 129, 0.45);
}

/* 窄屏时 admin-shell 改成纵向 */
@media (max-width: 768px) {
  .admin-shell {
    flex-direction: column;
    height: auto;
  }
  .admin-main {
    height: auto;
  }
}
</style>
