<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold text-ink-900">管理后台</h1>

    <div class="flex gap-1 overflow-x-auto border-b border-ink-200 text-sm">
      <button
        v-for="t in tabs"
        :key="t.key"
        @click="active = t.key"
        :class="[
          'whitespace-nowrap px-3 py-2 border-b-2 -mb-px',
          active === t.key
            ? 'border-ink-600 text-ink-900 font-medium'
            : 'border-transparent text-ink-500 hover:text-ink-700',
        ]"
      >
        {{ t.label }}
      </button>
    </div>

    <DashboardTab v-if="active === 'dashboard'" />
    <UsersTab v-else-if="active === 'users'" />
    <SectionsTab v-else-if="active === 'sections'" />
    <CardsTab v-else-if="active === 'cards'" />
    <SettingsTab v-else-if="active === 'settings'" />
    <AuditTab v-else-if="active === 'audit'" />
    <OAuthClientsTab v-else-if="active === 'oauth'" />
    <FaviconsTab v-else-if="active === 'favicons'" />
  </div>
</template>

<script setup>
import { ref } from "vue";
import DashboardTab from "../components/admin/DashboardTab.vue";
import UsersTab from "../components/admin/UsersTab.vue";
import SectionsTab from "../components/admin/SectionsTab.vue";
import CardsTab from "../components/admin/CardsTab.vue";
import SettingsTab from "../components/admin/SettingsTab.vue";
import AuditTab from "../components/admin/AuditTab.vue";
import OAuthClientsTab from "../components/admin/OAuthClientsTab.vue";
import FaviconsTab from "../components/admin/FaviconsTab.vue";

const tabs = [
  { key: "dashboard", label: "概览" },
  { key: "users", label: "用户" },
  { key: "sections", label: "板块" },
  { key: "cards", label: "卡片" },
  { key: "favicons", label: "图标" },
  { key: "oauth", label: "OAuth 应用" },
  { key: "settings", label: "设置" },
  { key: "audit", label: "审计" },
];
const active = ref("dashboard");
</script>
