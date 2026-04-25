<template>
  <nav class="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/70">
    <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <div class="flex h-14 items-center justify-between">
        <a href="#/" class="flex items-center gap-2.5 group">
          <div class="h-7 w-7 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white font-semibold text-sm shadow-soft">
            栖
          </div>
          <span class="font-semibold tracking-tight text-slate-900 group-hover:text-accent-700 transition-colors">栖枢</span>
        </a>

        <div class="flex items-center gap-1.5">
          <a href="#/" class="btn-ghost btn-sm">主页</a>
          <template v-if="!sessionLoaded">
            <span class="text-xs text-slate-400 px-2">…</span>
          </template>
          <template v-else-if="!currentUser">
            <a href="#/login" class="btn-ghost btn-sm">登录</a>
            <a href="#/register" class="btn-primary btn-sm">注册</a>
          </template>
          <template v-else>
            <a v-if="isAdmin" href="#/admin" class="btn-ghost btn-sm">管理</a>
            <a href="#/account" class="btn-ghost btn-sm flex items-center gap-1.5">
              <span class="h-5 w-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-medium text-slate-700">
                {{ initial }}
              </span>
              <span class="hidden sm:inline">{{ currentUser.name }}</span>
            </a>
            <button @click="onLogout" class="btn-ghost btn-sm">退出</button>
          </template>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed } from "vue";
import { currentUser, isAdmin, sessionLoaded, logout } from "../session.js";
import { navigate } from "../router.js";

const initial = computed(() => {
  const n = currentUser.value?.name || currentUser.value?.email || "?";
  return n.charAt(0).toUpperCase();
});

async function onLogout() {
  await logout();
  navigate("/");
}
</script>
