<template>
  <div class="app-shell" :class="{ 'has-sidebar': hasSidebar }">
    <NavBar v-if="showChrome" />

    <main :class="mainClass" :key="route.path" class="page-enter">
      <component :is="resolvedView" v-if="sessionLoaded" />
      <div v-else class="flex items-center justify-center py-32">
        <div class="flex items-center gap-3 text-fg-dim text-sm">
          <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine"></span>
          <span>加载中</span>
        </div>
      </div>
    </main>

    <footer v-if="showFooter" class="mt-auto pt-12">
      <div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="rule-h"></div>
        <div class="flex flex-wrap items-center justify-between gap-y-3 gap-x-6 py-6">
          <div class="flex items-center gap-3">
            <span class="sigil" style="width:1.5rem;height:1.5rem;border-radius:8px;"></span>
            <span class="text-sm text-fg-dim">Qi Shu</span>
          </div>
          <div class="text-xs text-fg-mute font-mono">© {{ year }}</div>
        </div>
      </div>
    </footer>

    <Toaster />
    <ConfirmDialog />
  </div>
</template>

<script setup>
import { computed, watch, onMounted } from "vue";
import { route, navigate, makeMatcher } from "./router.js";
import { loadSession, currentUser, sessionLoaded } from "./session.js";

import NavBar from "./components/NavBar.vue";
import Toaster from "./components/Toaster.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";

import HomePage from "./pages/HomePage.vue";
import LoginPage from "./pages/LoginPage.vue";
import RegisterPage from "./pages/RegisterPage.vue";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.vue";
import AccountPage from "./pages/AccountPage.vue";
import OAuthAuthorizePage from "./pages/OAuthAuthorizePage.vue";
import AdminPage from "./pages/AdminPage.vue";
import NotFoundPage from "./pages/NotFoundPage.vue";

const routes = [
  { path: "/", view: HomePage },
  { path: "/login", view: LoginPage },
  { path: "/register", view: RegisterPage },
  { path: "/forgot-password", view: ForgotPasswordPage },
  { path: "/account", view: AccountPage, requiresAuth: true },
  { path: "/oauth/authorize", view: OAuthAuthorizePage, requiresAuth: true },
  { path: "/admin", view: AdminPage, requiresAdmin: true },
];

const match = makeMatcher(routes, NotFoundPage);
const matched = computed(() => match(route.path));

const resolvedView = computed(() => {
  const m = matched.value;
  if (m.requiresAuth && !currentUser.value) return LoginPage;
  if (m.requiresAdmin && (!currentUser.value || currentUser.value.role !== "admin"))
    return NotFoundPage;
  return m.view;
});

// 顶栏与底栏的可见性:
//   /oauth/authorize 是嵌入式同意页面 — 顶栏底栏都不要
//   /admin 与 /account 用侧边栏布局,需要顶栏但不要底栏
//   其它公共页面(主页、登录、注册等)顶栏底栏都要
const showChrome = computed(() => route.path !== "/oauth/authorize");
const showFooter = computed(() =>
  route.path !== "/oauth/authorize" &&
  route.path !== "/admin" &&
  route.path !== "/account"
);

// hasSidebar 控制 main 区域是否要给侧边栏让位置
const hasSidebar = computed(() =>
  route.path === "/admin" || route.path === "/account"
);

const mainClass = computed(() => {
  if (route.path === "/admin" || route.path === "/account") {
    // 侧边栏页:main 占满剩余空间,内部自己滚动。padding/最大宽度由
    // AdminPage / AccountPage 各自的 .admin-outer / .account-outer 控制,
    // 这样它们的左右边界与顶栏 mx-auto max-w-7xl 完全一致。
    return "flex-1 w-full app-main-with-sidebar";
  }
  if (route.path.startsWith("/login") || route.path.startsWith("/register") || route.path.startsWith("/forgot"))
    return "flex-1 flex items-center justify-center px-4 py-16";
  if (route.path === "/oauth/authorize")
    return "flex-1 flex items-center justify-center px-4 py-16";
  return "flex-1 px-4 py-8 sm:px-6 lg:px-8 mx-auto w-full max-w-7xl";
});

const year = new Date().getFullYear();

onMounted(loadSession);

watch(currentUser, (v, old) => {
  if (old && !v && (matched.value.requiresAuth || matched.value.requiresAdmin)) {
    navigate("/login");
  }
});
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* 侧边栏页面:整个布局变成顶栏 + (侧栏 | 主区) 的两段式
   外层不再竖向滚动,主区内部自己滚动。 */
.app-shell.has-sidebar {
  height: 100vh;
  overflow: hidden;
}
.app-shell.has-sidebar .app-main-with-sidebar {
  /* main 元素本身不滚,留给页面内部布局自行处理 */
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
