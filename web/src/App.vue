<template>
  <div class="min-h-screen flex flex-col">
    <NavBar v-if="showChrome" />

    <main :class="mainClass" :key="route.path" class="page-enter">
      <component :is="resolvedView" v-if="sessionLoaded" />
      <div v-else class="flex items-center justify-center py-32">
        <div class="archive-no">LOADING · 加载档案中</div>
      </div>
    </main>

    <footer v-if="showChrome" class="mt-auto pt-12">
      <div class="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div class="rule-h-strong"></div>
        <div class="flex flex-wrap items-end justify-between gap-y-4 gap-x-8 py-5">
          <div class="flex items-baseline gap-3">
            <span class="font-display text-base text-ink tracking-tight">栖枢</span>
            <span class="archive-no">QISHU ARCHIVE · EST. 2024</span>
          </div>
          <div class="flex items-baseline gap-5 text-2xs">
            <a href="https://github.com/" target="_blank" rel="noopener" class="archive-no hover:text-ink transition-colors">
              SOURCE ↗
            </a>
            <span class="archive-no">VOL. I · № 001</span>
          </div>
        </div>
      </div>
    </footer>

    <Toaster />
  </div>
</template>

<script setup>
import { computed, watch, onMounted } from "vue";
import { route, navigate, makeMatcher } from "./router.js";
import { loadSession, currentUser, sessionLoaded } from "./session.js";

import NavBar from "./components/NavBar.vue";
import Toaster from "./components/Toaster.vue";

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

const showChrome = computed(() => route.path !== "/oauth/authorize");

const mainClass = computed(() => {
  if (route.path === "/admin") return "flex-1 w-full";
  if (route.path.startsWith("/login") || route.path.startsWith("/register") || route.path.startsWith("/forgot"))
    return "flex-1 flex items-center justify-center px-4 py-16";
  if (route.path === "/oauth/authorize")
    return "flex-1 flex items-center justify-center px-4 py-16";
  return "flex-1 px-4 py-10 sm:px-6 lg:px-8 mx-auto w-full max-w-6xl";
});

onMounted(loadSession);

watch(currentUser, (v, old) => {
  if (old && !v && (matched.value.requiresAuth || matched.value.requiresAdmin)) {
    navigate("/login");
  }
});
</script>
