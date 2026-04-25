<template>
  <div class="flex min-h-screen flex-col">
    <NavBar />

    <main class="flex-1 px-4 py-6 sm:px-6 lg:px-8 mx-auto w-full max-w-6xl">
      <component :is="resolvedView" />
    </main>

    <footer class="mt-auto border-t border-ink-100 bg-white py-3 text-center text-xs text-ink-400">
      栖枢 · 0.3.0
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
  if (!sessionLoaded.value) return null;
  const m = matched.value;
  if (m.requiresAuth && !currentUser.value) return LoginPage;
  if (m.requiresAdmin && (!currentUser.value || currentUser.value.role !== "admin"))
    return NotFoundPage;
  return m.view;
});

onMounted(loadSession);

// If session expires mid-session, kick to login.
watch(currentUser, (v, old) => {
  if (old && !v && (matched.value.requiresAuth || matched.value.requiresAdmin)) {
    navigate("/login");
  }
});
</script>
