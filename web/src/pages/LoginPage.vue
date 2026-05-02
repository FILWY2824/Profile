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

      <!-- OAuth 流程引导:当用户从第三方应用跳转过来但尚未登录时,
           App.vue 会因 requiresAuth 把当前路由临时渲染成本登录页。
           给用户一条清晰的提示,让他们知道登录后会回到授权确认页。 -->
      <div v-if="route.path === '/oauth/authorize'"
           class="mb-5 p-3.5 rounded-xl text-xs leading-relaxed flex items-start gap-2.5"
           style="background-color: rgba(20, 184, 166, 0.08); border: 1px solid rgba(20, 184, 166, 0.25); color: var(--fg-dim);">
        <svg class="h-4 w-4 mt-0.5 flex-shrink-0 text-teal-300"
             fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
             aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
        </svg>
        <div class="flex-1">
          <div class="font-medium text-fg mb-0.5">第三方应用授权请求</div>
          <span>请先登录你的栖枢账号 — 登录后将返回授权确认页,由你决定是否同意。</span>
        </div>
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
import { route, navigate } from "../router.js";
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
    // 关键修复: 如果当前 URL 实际上是另一条 requiresAuth 路由(例如第三方应用
    // 引导用户来到 /oauth/authorize),App.vue 仅是因没登录才暂时渲染成本页面。
    // 登录成功后保留原路由,让 App.vue 重新渲染目标页面 — 否则强制 navigate("/")
    // 会把 hash 改成 #/,丢失 OAuth 上下文(client_id / redirect_uri / state 等),
    // 三方应用看到的就是「用户登录后没回来」的失败现象。
    if (route.path === "/login") navigate("/");
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
