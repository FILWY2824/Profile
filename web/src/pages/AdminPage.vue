<template>
  <div class="flex min-h-[calc(100vh-3.5rem)]">
    <!-- Sidebar -->
    <aside class="hidden md:block w-56 flex-shrink-0 border-r border-slate-200 bg-white">
      <div class="p-4 space-y-1">
        <div class="px-3 py-1 text-[11px] uppercase tracking-wider text-slate-400 font-medium">概览</div>
        <button v-for="t in topTabs" :key="t.id"
                @click="active = t.id"
                :class="['tab-pill', active === t.id && 'tab-pill-active']">
          <span>{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </button>

        <div class="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wider text-slate-400 font-medium">内容管理</div>
        <button v-for="t in contentTabs" :key="t.id"
                @click="active = t.id"
                :class="['tab-pill', active === t.id && 'tab-pill-active']">
          <span>{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </button>

        <div class="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wider text-slate-400 font-medium">系统</div>
        <button v-for="t in systemTabs" :key="t.id"
                @click="active = t.id"
                :class="['tab-pill', active === t.id && 'tab-pill-active']">
          <span>{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </button>
      </div>
    </aside>

    <!-- Mobile tabs -->
    <div class="md:hidden border-b border-slate-200 bg-white overflow-x-auto whitespace-nowrap p-2 sticky top-14 z-20">
      <button v-for="t in [...topTabs, ...contentTabs, ...systemTabs]" :key="t.id"
              @click="active = t.id"
              :class="['inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium mr-1',
                       active === t.id ? 'bg-slate-900 text-white' : 'text-slate-600']">
        {{ t.icon }} {{ t.label }}
      </button>
    </div>

    <!-- Content -->
    <main class="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-6xl">
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

const topTabs = [{ id: "dashboard", label: "总览", icon: "📊" }];
const contentTabs = [
  { id: "sections", label: "板块", icon: "📁" },
  { id: "cards", label: "卡片", icon: "🔗" },
  { id: "favicons", label: "图标缓存", icon: "🖼️" },
];
const systemTabs = [
  { id: "users", label: "用户", icon: "👥" },
  { id: "oauth", label: "OAuth 客户端", icon: "🔑" },
  { id: "settings", label: "系统设置", icon: "⚙️" },
  { id: "audit", label: "审计", icon: "📜" },
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
</script>
