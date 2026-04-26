<template>
  <div class="w-full max-w-md">
    <div class="flex items-center justify-center mb-6">
      <a href="#/" class="flex items-center gap-3">
        <span class="sigil-lg"></span>
      </a>
    </div>

    <div class="surface-glass p-8 sm:p-10">
      <div class="text-center mb-6">
        <h1 class="h-page text-3xl mb-1.5">{{ step === 1 ? "创建账号" : "邮箱验证" }}</h1>
        <p class="text-fg-dim text-sm">
          {{ step === 1 ? "几秒钟创建你的账号" : `验证码已发送至 ${email}` }}
        </p>
      </div>

      <!-- 步骤指示 -->
      <div class="flex items-center gap-3 mb-6">
        <div class="flex-1 flex items-center gap-2">
          <span :class="['step-dot', step >= 1 && 'step-dot-active']">1</span>
          <span :class="['text-xs', step === 1 ? 'text-fg font-semibold' : 'text-fg-dim']">填写资料</span>
        </div>
        <div class="flex-1 h-px" style="background: rgba(15, 36, 25, 0.10)"></div>
        <div class="flex-1 flex items-center gap-2 justify-end">
          <span :class="['text-xs', step === 2 ? 'text-fg font-semibold' : 'text-fg-dim']">邮箱核验</span>
          <span :class="['step-dot', step >= 2 && 'step-dot-active']">2</span>
        </div>
      </div>

      <form v-if="step === 1" @submit.prevent="onSendCode" class="space-y-4">
        <div>
          <label class="label">邮箱地址</label>
          <input v-model="email" type="email" required class="input" placeholder="you@example.com" />
        </div>
        <div>
          <label class="label">显示名</label>
          <input v-model="name" required maxlength="60" class="input" placeholder="昵称" />
        </div>
        <div>
          <label class="label">密码 (至少 8 字符)</label>
          <PasswordInput v-model="password" required :minlength="8" autocomplete="new-password" placeholder="••••••••" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>

        <div class="pt-2">
          <button :disabled="busy" class="btn btn-primary w-full">
            {{ busy ? "正在发送…" : "发送验证码" }}
          </button>
        </div>
      </form>

      <form v-else @submit.prevent="onConfirm" class="space-y-4">
        <div>
          <label class="label">六位验证码</label>
          <input v-model="code" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric"
                 class="input input-mono text-center text-2xl font-semibold tracking-[0.5em] py-3"
                 placeholder="000000" />
        </div>
        <div class="pt-1 space-y-2.5">
          <button :disabled="busy" class="btn btn-primary w-full">
            {{ busy ? "核验中…" : "完成注册" }}
          </button>
          <button type="button" @click="step = 1" class="btn btn-ghost w-full">
            ← 返回上一步
          </button>
        </div>
      </form>
    </div>

    <div class="mt-6 flex items-center justify-between">
      <a href="#/" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">← 返回主页</a>
      <a href="#/login" class="text-xs text-fg-mute hover:text-fg-dim transition-colors">已有账号 · 登录 →</a>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { okToast, errToast } from "../toast.js";
import PasswordInput from "../components/PasswordInput.vue";

const step = ref(1);
const email = ref("");
const password = ref("");
const name = ref("");
const code = ref("");
const busy = ref(false);
const turnstileSiteKey = ref("");

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

onMounted(async () => {
  try {
    const cfg = await api.get("/auth/turnstile-config");
    if (cfg.enabled && cfg.siteKey) {
      turnstileSiteKey.value = cfg.siteKey;
      // 防止重复加载 Turnstile 脚本(用户在 SPA 内部多次切换页面也是同一个 document)
      if (!document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)) {
        const s = document.createElement("script");
        s.src = TURNSTILE_SCRIPT;
        s.async = true; s.defer = true;
        document.head.appendChild(s);
      } else if (window.turnstile) {
        // 已经加载过,显式 render 一次以触发新挂载的 .cf-turnstile div
        setTimeout(() => window.turnstile.render?.(".cf-turnstile"), 0);
      }
    }
  } catch {}
});

async function onSendCode() {
  busy.value = true;
  try {
    const tsToken = window.turnstile?.getResponse?.() || "";
    await api.post("/auth/register", {
      email: email.value, password: password.value, name: name.value,
      turnstileToken: tsToken,
    });
    step.value = 2;
    okToast("验证码已发送至您的邮箱");
  } catch (e) {
    errToast(e.message);
    if (window.turnstile) window.turnstile.reset();
  } finally {
    busy.value = false;
  }
}

async function onConfirm() {
  busy.value = true;
  try {
    await api.post("/auth/register/confirm", {
      email: email.value, code: code.value,
    });
    okToast("注册成功");
    await loadSession();
    navigate("/");
  } catch (e) {
    errToast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  background-color: rgba(15, 36, 25, 0.06);
  color: var(--fg-mute);
  border: 1px solid rgba(15, 36, 25, 0.10);
  flex-shrink: 0;
  transition: all 0.18s;
}
.step-dot-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 10px -3px rgba(16, 185, 129, 0.45);
}
</style>
