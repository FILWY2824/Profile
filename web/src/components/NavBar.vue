<template>
  <nav class="sticky top-0 z-30 px-4 sm:px-6 lg:px-8 pt-4">
    <div class="mx-auto max-w-7xl">
      <div class="nav-glass">
        <!-- Logo + 站点名 -->
        <a href="#/" class="brand-link">
          <span class="sigil"></span>
          <span class="hidden sm:flex flex-col leading-tight ml-1">
            <span class="brand-name">{{ siteName }}</span>
            <span class="brand-sub">工具面板</span>
          </span>
        </a>

        <!-- 中部链接 + 右侧操作 -->
        <div class="flex items-center gap-1.5">
          <a href="#/" class="nav-link" :class="route.path === '/' && 'nav-link-active'">主页</a>

          <template v-if="!sessionLoaded">
            <span class="text-fg-mute text-sm px-3">…</span>
          </template>

          <template v-else-if="!currentUser">
            <a href="#/login" class="nav-link hidden sm:inline-flex">登录</a>
            <a href="#/register" class="btn btn-primary btn-sm ml-1">注册</a>
          </template>

          <template v-else>
            <a v-if="isAdmin" href="#/admin" class="nav-link hidden sm:inline-flex"
               :class="route.path === '/admin' && 'nav-link-active'">管理</a>

            <!-- Avatar dropdown -->
            <div class="relative ml-1" ref="dropdownRef">
              <button
                @click="open = !open"
                class="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full transition-colors hover:bg-white/60"
                :class="open && 'bg-white/70'"
              >
                <span class="nav-avatar">{{ initial }}</span>
                <span class="hidden sm:inline text-sm text-fg-dim font-medium">{{ currentUser.name }}</span>
                <svg class="h-3.5 w-3.5 text-fg-mute transition-transform" :class="open && 'rotate-180'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
                </svg>
              </button>

              <transition name="dd">
                <div v-if="open" class="absolute right-0 top-full mt-2 w-60 surface-glass overflow-hidden">
                  <div class="px-4 py-3 border-b border-line">
                    <div class="text-sm font-semibold text-fg truncate">{{ currentUser.name }}</div>
                    <div class="text-xs text-fg-mute font-mono truncate mt-0.5">{{ currentUser.email }}</div>
                  </div>
                  <div class="p-1.5">
                    <a href="#/account" @click="open = false" class="dd-item">
                      <span class="text-base">👤</span>
                      <span>账户中心</span>
                    </a>
                    <a v-if="isAdmin" href="#/admin" @click="open = false" class="dd-item">
                      <span class="text-base">⚙️</span>
                      <span>管理后台</span>
                    </a>
                    <button @click="onLogout" class="dd-item dd-item-danger w-full text-left">
                      <span class="text-base">↗</span>
                      <span>退出登录</span>
                    </button>
                  </div>
                </div>
              </transition>
            </div>
          </template>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue";
import { currentUser, isAdmin, sessionLoaded, logout } from "../session.js";
import { route, navigate } from "../router.js";
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
  try {
    const data = await api.get("/homepage");
    if (data.siteName) siteName.value = data.siteName;
  } catch {}
});
onUnmounted(() => document.removeEventListener("click", onClickOutside));
</script>

<style scoped>
.nav-glass {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 20px;
  padding: 8px 12px 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.85) inset,
    0 8px 32px -12px rgba(15, 36, 25, 0.10);
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 11px;
  text-decoration: none;
  color: var(--fg);
  padding: 4px 6px 4px 4px;
  border-radius: 12px;
  transition: background-color 0.15s;
}
.brand-link:hover {
  background-color: rgba(255, 255, 255, 0.5);
}

.brand-name {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-variation-settings: "opsz" 36;
  font-size: 17px;
  letter-spacing: -0.022em;
  color: var(--fg);
  line-height: 1;
}
.brand-sub {
  font-size: 10px;
  color: var(--fg-mute);
  font-weight: 500;
  letter-spacing: 0.02em;
  margin-top: 2px;
}

.nav-link {
  color: var(--fg-dim);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  transition: background-color 0.15s, color 0.15s;
  display: inline-flex;
  align-items: center;
}
.nav-link:hover {
  background-color: rgba(255, 255, 255, 0.6);
  color: var(--fg);
}
.nav-link-active {
  background: linear-gradient(135deg, var(--brand-hi), var(--brand) 60%, var(--brand-deep));
  color: #fff !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 4px 12px -4px rgba(16, 185, 129, 0.4);
}
.nav-link-active:hover {
  color: #fff;
}

.nav-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #34D399, #10B981 55%, #047857);
  color: white;
  font-weight: 700;
  font-size: 13px;
  border: 1.5px solid white;
  box-shadow: 0 2px 8px -2px rgba(15, 36, 25, 0.25);
}

.dd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--fg-dim);
  transition: background-color 0.14s, color 0.14s;
  background: transparent;
  border: none;
  cursor: pointer;
}
.dd-item:hover {
  background-color: rgba(16, 185, 129, 0.08);
  color: var(--fg);
}
.dd-item-danger {
  color: var(--danger);
}
.dd-item-danger:hover {
  background-color: rgba(220, 38, 38, 0.08);
  color: var(--danger);
}

.dd-enter-active, .dd-leave-active { transition: all 0.16s cubic-bezier(0.2, 0.8, 0.2, 1); }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>
