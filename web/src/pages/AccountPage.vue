<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold text-ink-900">个人中心</h1>

    <div class="flex gap-1 border-b border-ink-200 text-sm">
      <button
        v-for="t in tabs"
        :key="t.key"
        @click="active = t.key"
        :class="[
          'px-3 py-2 border-b-2 -mb-px',
          active === t.key
            ? 'border-ink-600 text-ink-900 font-medium'
            : 'border-transparent text-ink-500 hover:text-ink-700',
        ]"
      >
        {{ t.label }}
      </button>
    </div>

    <ProfileTab v-if="active === 'profile'" />
    <PasswordTab v-else-if="active === 'password'" />
    <LoginHistoryTab v-else-if="active === 'logins'" />
    <ActivityTab v-else-if="active === 'activity'" />
    <GrantsTab v-else-if="active === 'grants'" />
  </div>
</template>

<script setup>
import { ref } from "vue";
import ProfileTab from "../components/account/ProfileTab.vue";
import PasswordTab from "../components/account/PasswordTab.vue";
import LoginHistoryTab from "../components/account/LoginHistoryTab.vue";
import ActivityTab from "../components/account/ActivityTab.vue";
import GrantsTab from "../components/account/GrantsTab.vue";

const tabs = [
  { key: "profile", label: "资料" },
  { key: "password", label: "密码" },
  { key: "logins", label: "登录历史" },
  { key: "activity", label: "活动日志" },
  { key: "grants", label: "已授权应用" },
];
const active = ref("profile");
</script>
