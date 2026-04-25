<template>
  <div class="flex min-h-[calc(100vh-3.5rem)]">
    <!-- 左侧导航 -->
    <aside class="hidden md:flex flex-col w-60 flex-shrink-0 border-r border-line bg-bg-2/60">
      <div class="px-5 pt-6 pb-5 border-b border-line">
        <div class="flex items-center gap-3">
          <span class="sigil"></span>
          <div>
            <div class="font-display font-bold text-fg text-[15px] tracking-tight leading-tight">管理后台</div>
            <div class="text-[10px] text-fg-mute mt-0.5 font-mono">ADMIN PANEL</div>
          </div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3 space-y-5">
        <div>
          <div class="text-[10px] font-medium text-fg-mute uppercase tracking-wider px-3 mb-2">概览</div>
          <button v-for="t in topTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="text-[10px] font-medium text-fg-mute uppercase tracking-wider px-3 mb-2">内容</div>
          <button v-for="t in contentTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="text-[10px] font-medium text-fg-mute uppercase tracking-wider px-3 mb-2">系统</div>
          <button v-for="t in systemTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span class="text-base">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </button>
        </div>
      </nav>
      <div class="border-t border-line px-5 py-3 text-xs text-fg-mute font-mono">
        {{ today }}
      </div>
    </aside>

    <!-- 移动端 tab -->
    <div class="md:hidden border-b border-line bg-bg-2/80 backdrop-blur overflow-x-auto whitespace-nowrap p-2 sticky top-14 z-20">
      <button v-for="t in [...topTabs, ...contentTabs, ...systemTabs]" :key="t.id"
              @click="active = t.id"
              :class="[
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs mr-1 transition-colors',
                active === t.id ? 'bg-teal-300 text-[#062521] font-medium' : 'text-fg-dim'
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
