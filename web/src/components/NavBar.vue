<template>
  <nav class="sticky top-0 z-30">
    <!-- 顶部超细朱砂线 -->
    <div class="h-[3px] bg-cinnabar"></div>
    <div class="bg-paper/85 backdrop-blur-md border-b border-rule-soft">
      <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-14 items-center justify-between gap-6">

          <!-- 印鉴 logo + 卷宗号 -->
          <a href="#/" class="group flex items-center gap-3">
            <span class="seal">栖</span>
            <span class="hidden sm:flex flex-col leading-tight">
              <span class="font-display text-base text-ink tracking-tight group-hover:text-cinnabar transition-colors">栖枢</span>
              <span class="archive-no" style="letter-spacing:0.24em;font-size:9px;">QISHU · ARCHIVE</span>
            </span>
          </a>

          <!-- 右侧导航 -->
          <div class="flex items-center gap-1">
            <a href="#/" class="btn btn-ghost btn-sm uppercase tracking-archive2">
              <span class="archive-no">主页 · Home</span>
            </a>

            <template v-if="!sessionLoaded">
              <span class="archive-no opacity-50 px-3">…</span>
            </template>

            <template v-else-if="!currentUser">
              <a href="#/login" class="btn btn-ghost btn-sm">
                <span class="archive-no">登录</span>
              </a>
              <a href="#/register" class="btn btn-primary btn-sm">
                <span class="archive-no" style="color:inherit;letter-spacing:0.24em;">注册 →</span>
              </a>
            </template>

            <template v-else>
              <a v-if="isAdmin" href="#/admin" class="btn btn-ghost btn-sm">
                <span class="archive-no">管理</span>
              </a>
              <a href="#/account" class="btn btn-ghost btn-sm flex items-center gap-2">
                <span class="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-ink/30 bg-paper-200 font-mono text-xs text-ink">
                  {{ initial }}
                </span>
                <span class="hidden sm:inline archive-no">{{ currentUser.name }}</span>
              </a>
              <button @click="onLogout" class="btn btn-ghost btn-sm">
                <span class="archive-no">退出</span>
              </button>
            </template>
          </div>

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
