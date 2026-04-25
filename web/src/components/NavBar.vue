<template>
  <nav class="sticky top-0 z-30">
    <div class="surface-glass rounded-none border-l-0 border-r-0 border-t-0">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-14 items-center justify-between gap-6">

          <!-- Logo + 站点名 -->
          <a href="#/" class="group flex items-center gap-2.5 -ml-1 px-1 py-1 rounded-lg hover:bg-white/5 transition-colors">
            <span class="sigil"></span>
            <span class="hidden sm:flex flex-col leading-tight">
              <span class="font-display font-bold text-fg tracking-tight text-[15px]">{{ siteName }}</span>
              <span class="text-[10px] text-fg-mute font-medium tracking-wide">工具面板</span>
            </span>
          </a>

          <!-- 右侧导航 -->
          <div class="flex items-center gap-1">
            <a href="#/" class="btn btn-ghost btn-sm hidden sm:inline-flex">主页</a>

            <template v-if="!sessionLoaded">
              <span class="text-fg-mute text-sm px-3">…</span>
            </template>

            <template v-else-if="!currentUser">
              <a href="#/login" class="btn btn-ghost btn-sm">登录</a>
              <a href="#/register" class="btn btn-primary btn-sm">注册</a>
            </template>

            <template v-else>
              <a v-if="isAdmin" href="#/admin" class="btn btn-ghost btn-sm hidden sm:inline-flex">管理</a>

              <!-- Avatar dropdown -->
              <div class="relative" ref="dropdownRef">
                <button
                  @click="open = !open"
                  class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
                  :class="open && 'bg-white/5'"
                >
                  <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-300 to-teal-500 text-[#062521] font-bold text-sm">
                    {{ initial }}
                  </span>
                  <span class="hidden sm:inline text-sm text-fg-dim">{{ currentUser.name }}</span>
                  <svg class="h-3.5 w-3.5 text-fg-mute transition-transform" :class="open && 'rotate-180'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>

                <transition name="dd">
                  <div v-if="open" class="absolute right-0 top-full mt-2 w-56 surface-glass shadow-pop overflow-hidden">
                    <div class="px-4 py-3 border-b border-line">
                      <div class="text-sm font-medium text-fg truncate">{{ currentUser.name }}</div>
                      <div class="text-xs text-fg-mute font-mono truncate">{{ currentUser.email }}</div>
                    </div>
                    <div class="p-1.5">
                      <a href="#/account" @click="open = false" class="block px-3 py-2 rounded-md text-sm text-fg-dim hover:bg-white/5 hover:text-fg transition-colors">
                        账户中心
                      </a>
                      <a v-if="isAdmin" href="#/admin" @click="open = false" class="block px-3 py-2 rounded-md text-sm text-fg-dim hover:bg-white/5 hover:text-fg transition-colors">
                        管理后台
                      </a>
                      <button @click="onLogout" class="w-full text-left block px-3 py-2 rounded-md text-sm text-danger hover:bg-danger/10 transition-colors">
                        退出登录
                      </button>
                    </div>
                  </div>
                </transition>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue";
import { currentUser, isAdmin, sessionLoaded, logout } from "../session.js";
import { navigate } from "../router.js";
import { api } from "../api.js";

const open = ref(false);
const dropdownRef = ref(null);
const siteName = ref("Hub");

const initial = computed(() => {
  const n = currentUser.value?.name || currentUser.value?.email || "?";
  return n.charAt(0).toUpperCase();
});

async function onLogout() {
  open.value = false;
  await logout();
  navigate("/");
}

function onClickOutside(e) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
    open.value = false;
  }
}

onMounted(async () => {
  document.addEventListener("click", onClickOutside);
  // 拉一次站点名(轻量, 与 HomePage 共享 /homepage 缓存)
  try {
    const data = await api.get("/homepage");
    if (data.siteName) siteName.value = data.siteName;
  } catch {}
});
onUnmounted(() => document.removeEventListener("click", onClickOutside));
</script>

<style scoped>
.dd-enter-active, .dd-leave-active { transition: all 0.16s cubic-bezier(0.2,0.8,0.2,1); }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>
