<template>
  <div class="mx-auto max-w-sm">
    <div class="card p-6">
      <h1 class="mb-6 text-xl font-semibold text-ink-900">重置密码</h1>

      <form v-if="step === 1" @submit.prevent="onRequest" class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">邮箱</label>
          <input v-model="email" type="email" required class="input" />
        </div>
        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "发送中…" : "发送验证码" }}
        </button>
      </form>

      <form v-else @submit.prevent="onReset" class="space-y-4">
        <p class="rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
          若 <strong>{{ email }}</strong> 已注册,我们已发送验证码。
          <span v-if="devCode" class="text-xs text-ink-400">(开发模式: {{ devCode }})</span>
        </p>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">验证码</label>
          <input v-model="code" type="text" required class="input tracking-widest text-center" maxlength="6" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">新密码</label>
          <input v-model="password" type="password" required class="input" minlength="8" />
        </div>

        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "重置中…" : "重置密码" }}
        </button>
        <button type="button" @click="step = 1" class="btn-secondary w-full">返回</button>
      </form>

      <div class="mt-4 text-center text-sm text-ink-500">
        <a href="#/login" class="hover:text-ink-700">返回登录</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { okToast, errToast } from "../toast.js";

const step = ref(1);
const email = ref("");
const code = ref("");
const password = ref("");
const devCode = ref("");
const busy = ref(false);

async function onRequest() {
  busy.value = true;
  try {
    const r = await api.post("/auth/forgot-password", { email: email.value });
    // Backend always says "ok" to prevent enumeration. devCode is only
    // returned in dev mode, and only if the email actually exists.
    devCode.value = r.devCode || "";
    step.value = 2;
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

async function onReset() {
  busy.value = true;
  try {
    await api.post("/auth/reset-password", {
      email: email.value,
      code: code.value,
      newPassword: password.value,
    });
    okToast("密码已重置,请使用新密码登录");
    navigate("/login");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
