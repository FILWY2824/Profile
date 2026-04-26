<template>
  <div class="w-full max-w-md">
    <!-- 顶部 logo -->
    <div class="flex items-center justify-center mb-6">
      <a href="#/" class="flex items-center gap-3">
        <span class="sigil-lg"></span>
      </a>
    </div>

    <div class="surface-glass p-8 sm:p-10">
      <div class="text-center mb-7">
        <h1 class="h-page text-3xl mb-1.5">欢迎回来<span class="text-teal-300">.</span></h1>
        <p class="text-fg-dim text-sm">登录到你的账户</p>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required autofocus class="input"
                 placeholder="you@example.com" autocomplete="username" />
        </div>
        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <label class="label !mb-0">密码</label>
            <a href="#/forgot-password" class="text-xs text-teal-300 hover:text-teal-200 transition-colors">忘记密码?</a>
          </div>
          <PasswordInput v-model="password" required autocomplete="current-password" placeholder="••••••••" />
        </div>

        <div v-if="ts.enabled.value" class="pt-1">
          <div :ref="el => (ts.container.value = el)"></div>
          <p v-if="ts.loaded.value && !ts.token.value" class="text-xs text-fg-mute mt-2">
            请先完成上方人机验证
          </p>
        </div>

        <div class="pt-2">
          <button :disabled="busy || !ts.canSubmit.value" class="btn btn-primary w-full">
            {{ submitLabel }}
          </button>
        </div>
      </form>

      <div class="rule-h mt-7 mb-5"></div>

      <p class="text-center text-sm text-fg-dim">
        还没有账号?
        <a href="#/register" class="text-teal-300 hover:text-teal-200 font-medium transition-colors">
          立即注册
        </a>
      </p>
    </div>

    <div class="mt-6 flex items-center justify-center">
      <a href="#/" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">← 返回主页</a>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { errToast, okToast } from "../toast.js";
import PasswordInput from "../components/PasswordInput.vue";
import { useTurnstile } from "../composables/useTurnstile.js";

const email = ref("");
const password = ref("");
const busy = ref(false);
const ts = useTurnstile();

const submitLabel = computed(() => {
  if (busy.value) return "正在登录…";
  if (ts.enabled.value && !ts.token.value) return "请完成人机验证";
  return "登录";
});

async function onSubmit() {
  if (busy.value) return;
  if (ts.enabled.value && !ts.token.value) {
    errToast("请先完成人机验证");
    return;
  }
  busy.value = true;
  try {
    await api.post("/auth/login", {
      email: email.value, password: password.value, turnstileToken: ts.token.value,
    });
    okToast("登录成功");
    await loadSession();
    navigate("/");
  } catch (e) {
    errToast(e.message);
    // 单 token 用完即弃。无论失败原因都把 widget reset 一次,让下次提交是干净的,
    // 这样用户不会因为旧 token 已被服务端消费而再吃一次 400。
    ts.reset();
  } finally {
    busy.value = false;
  }
}
</script>
