<template>
  <div class="flex min-h-[calc(100vh-3.5rem)] bg-paper">
    <!-- 左侧导航 -->
    <aside class="hidden md:flex flex-col w-60 flex-shrink-0 border-r border-rule-soft bg-paper-50">
      <div class="px-5 pt-7 pb-5 border-b border-rule-soft">
        <div class="flex items-center gap-3">
          <span class="seal">栖</span>
          <div>
            <div class="archive-no text-cinnabar">ADMIN · 后台</div>
            <div class="font-display text-base text-ink tracking-tight leading-tight mt-0.5">栖枢档案</div>
          </div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3 space-y-5">
        <div>
          <div class="archive-no px-3 mb-2">§ I · 概览</div>
          <button v-for="t in topTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="archive-no px-3 mb-2">§ II · 内容管理</div>
          <button v-for="t in contentTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span>{{ t.label }}</span>
          </button>
        </div>
        <div>
          <div class="archive-no px-3 mb-2">§ III · 系统</div>
          <button v-for="t in systemTabs" :key="t.id"
                  @click="active = t.id"
                  :class="['tab-pill', active === t.id && 'tab-pill-active']">
            <span>{{ t.label }}</span>
          </button>
        </div>
      </nav>
      <div class="border-t border-rule-soft px-5 py-4">
        <div class="archive-no">VOL. I · ADMIN</div>
        <div class="archive-no opacity-60 mt-0.5">{{ today }}</div>
      </div>
    </aside>

    <!-- 移动端 tab -->
    <div class="md:hidden border-b border-rule-soft bg-paper-50 overflow-x-auto whitespace-nowrap p-2 sticky top-14 z-20">
      <button v-for="t in [...topTabs, ...contentTabs, ...systemTabs]" :key="t.id"
              @click="active = t.id"
              :class="[
                'inline-flex items-center px-3 py-1.5 rounded-sm font-mono text-2xs uppercase tracking-archive mr-1',
                active === t.id ? 'bg-ink text-paper' : 'text-ash'
              ]">
        {{ t.label }}
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

const topTabs = [{ id: "dashboard", label: "总览 · Dashboard" }];
const contentTabs = [
  { id: "sections", label: "板块 · Sections" },
  { id: "cards",    label: "卡片 · Cards" },
  { id: "favicons", label: "图标缓存 · Icons" },
];
const systemTabs = [
  { id: "users",    label: "用户 · Users" },
  { id: "oauth",    label: "OAuth 客户端" },
  { id: "settings", label: "系统设置" },
  { id: "audit",    label: "审计 · Audit" },
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
