<template>
  <div class="mx-auto max-w-sm">
    <div class="card p-6">
      <h1 class="mb-6 text-xl font-semibold text-ink-900">登录</h1>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">邮箱</label>
          <input v-model="email" type="email" required autocomplete="email" class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">密码</label>
          <input v-model="password" type="password" required autocomplete="current-password" class="input" />
        </div>

        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "登录中…" : "登录" }}
        </button>
      </form>

      <div class="mt-4 flex items-center justify-between text-sm text-ink-500">
        <a href="#/register" class="hover:text-ink-700">注册账号</a>
        <a href="#/forgot-password" class="hover:text-ink-700">忘记密码?</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate, route } from "../router.js";
import { okToast, errToast } from "../toast.js";

const email = ref("");
const password = ref("");
const busy = ref(false);

async function onSubmit() {
  busy.value = true;
  try {
    await api.post("/auth/login", { email: email.value, password: password.value });
    await loadSession();
    okToast("登录成功");
    // If a "next" query param exists, jump there; else home.
    const next = route.query.next || "/";
    navigate(next);
  } catch (e) {
    errToast(e.message || "登录失败");
  } finally {
    busy.value = false;
  }
}
</script>
