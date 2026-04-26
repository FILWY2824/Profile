<template>
  <div class="admin-shell">
    <!-- 左侧导航 -->
    <aside class="admin-sidebar hidden md:flex flex-col">
      <div class="admin-brand">
        <div class="flex items-center gap-3">
          <span class="sigil"></span>
          <div>
            <div class="font-display font-bold text-fg text-[15px] tracking-tight leading-tight">管理后台</div>
            <div class="text-[10px] text-fg-mute mt-0.5 font-mono tracking-wider">ADMIN PANEL</div>
          </div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3 space-y-5">
        <div>
          <div class="admin-group-label">概览</div>
          <button v-for="t in topTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="admin-group-label">内容</div>
          <button v-for="t in contentTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="admin-group-label">系统</div>
          <button v-for="t in systemTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
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
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs mr-1 transition-colors',
                active === t.id ? 'admin-mobile-tab-active' : 'text-fg-dim'
              ]">
        <span>{{ t.icon }}</span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 主内容 -->
    <main class="flex-1 px-4 sm:px-8 lg:px-10 py-8 max-w-6xl">
      <component :is="activeView" />
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

const topTabs = [{ id: "dashboard", icon: "🏠", label: "总览" }];
const contentTabs = [
  { id: "sections", icon: "📂", label: "板块" },
  { id: "cards",    icon: "🔗", label: "卡片" },
  { id: "favicons", icon: "🎨", label: "图标缓存" },
];
const systemTabs = [
  { id: "users",    icon: "👥", label: "用户" },
  { id: "oauth",    icon: "🔑", label: "OAuth 客户端" },
  { id: "settings", icon: "⚙️", label: "系统设置" },
  { id: "audit",    icon: "📜", label: "审计日志" },
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
  min-height: calc(100vh - 5rem);
}

.admin-sidebar {
  width: 15rem;
  flex-shrink: 0;
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid rgba(15, 36, 25, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  margin: 0 0 0 16px;
  border-radius: 20px 20px 0 0;
  align-self: flex-start;
  position: sticky;
  top: 5rem;
  max-height: calc(100vh - 6rem);
  display: flex;
  flex-direction: column;
}

.admin-brand {
  padding: 22px 20px 18px;
  border-bottom: 1px solid rgba(15, 36, 25, 0.08);
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

.admin-foot {
  border-top: 1px solid rgba(15, 36, 25, 0.08);
  padding: 12px 20px;
  font-size: 11px;
  color: var(--fg-mute);
  font-family: "JetBrains Mono", ui-monospace, monospace;
}

.admin-mobile-tabs {
  position: sticky;
  top: 5rem;
  z-index: 20;
  margin: 0 16px;
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
</style>
