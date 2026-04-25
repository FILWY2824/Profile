<template>
  <div class="mx-auto max-w-sm">
    <div class="card p-6">
      <h1 class="mb-6 text-xl font-semibold text-ink-900">注册账号</h1>

      <!-- Step 1: enter details, get code -->
      <form v-if="step === 1" @submit.prevent="onRequest" class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">邮箱</label>
          <input v-model="email" type="email" required class="input" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">显示名称</label>
          <input v-model="name" type="text" required class="input" maxlength="32" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">密码</label>
          <input v-model="password" type="password" required class="input" minlength="8" />
          <p class="mt-1 text-xs text-ink-500">至少 8 位</p>
        </div>

        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "发送中…" : "下一步:获取验证码" }}
        </button>
      </form>

      <!-- Step 2: enter code -->
      <form v-else @submit.prevent="onConfirm" class="space-y-4">
        <p class="rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
          已向 <strong>{{ email }}</strong> 发送验证码
          <span v-if="devCode" class="text-xs text-ink-400">(开发模式: {{ devCode }})</span>
        </p>

        <div>
          <label class="mb-1 block text-sm font-medium text-ink-700">验证码</label>
          <input v-model="code" type="text" required class="input tracking-widest text-center" maxlength="6" />
        </div>

        <button :disabled="busy" class="btn-primary w-full">
          {{ busy ? "验证中…" : "完成注册" }}
        </button>

        <button type="button" @click="step = 1" class="btn-secondary w-full">返回上一步</button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { okToast, errToast } from "../toast.js";

const step = ref(1);
const email = ref("");
const name = ref("");
const password = ref("");
const code = ref("");
const devCode = ref("");
const busy = ref(false);

async function onRequest() {
  busy.value = true;
  try {
    const r = await api.post("/auth/register", {
      email: email.value,
      name: name.value,
      password: password.value,
    });
    devCode.value = r.devCode || "";
    step.value = 2;
    okToast("验证码已发送");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}

async function onConfirm() {
  busy.value = true;
  try {
    await api.post("/auth/register/confirm", { email: email.value, code: code.value });
    await loadSession();
    okToast("注册成功");
    navigate("/");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
