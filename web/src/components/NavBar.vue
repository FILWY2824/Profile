<template>
  <nav class="border-b border-ink-100 bg-white/80 backdrop-blur sticky top-0 z-40">
    <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <a href="#/" class="flex items-center gap-2 text-lg font-semibold text-ink-900 hover:text-ink-700">
        <span class="inline-block h-6 w-6 rounded bg-ink-600 text-center text-sm leading-6 text-white">栖</span>
        栖枢
      </a>

      <div class="flex items-center gap-1 text-sm">
        <a v-if="!user" href="#/login" class="rounded px-3 py-1.5 text-ink-700 hover:bg-ink-50">登录</a>
        <a v-if="!user" href="#/register" class="btn-primary">注册</a>

        <template v-if="user">
          <a href="#/account" class="rounded px-3 py-1.5 text-ink-700 hover:bg-ink-50">个人中心</a>
          <a v-if="user.role === 'admin'" href="#/admin" class="rounded px-3 py-1.5 text-ink-700 hover:bg-ink-50">管理后台</a>
          <span class="ml-2 hidden text-xs text-ink-500 sm:inline">{{ user.email }}</span>
          <button @click="onLogout" class="btn-secondary">退出</button>
        </template>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { currentUser, logout } from "../session.js";
import { navigate } from "../router.js";
import { okToast } from "../toast.js";

const user = currentUser;

async function onLogout() {
  await logout();
  okToast("已退出登录");
  navigate("/login");
}
</script>
