<template>
  <div class="w-full max-w-md">
    <!-- 文头档案号 -->
    <div class="flex items-baseline justify-between mb-4">
      <span class="archive-no">FORM № L-001</span>
      <a href="#/" class="archive-no hover:text-ink transition-colors">← 返回</a>
    </div>
    <div class="rule-h-strong mb-6"></div>

    <div class="surface-elevated p-8 sm:p-10">
      <!-- 印章 + 标题 -->
      <div class="flex items-center gap-4 mb-7">
        <span class="seal seal-lg">栖</span>
        <div>
          <div class="archive-no mb-1">SIGN-IN · 登入</div>
          <h1 class="h-section">欢迎归来</h1>
        </div>
      </div>

      <div class="rule-h mb-6"></div>

      <form @submit.prevent="onSubmit" class="space-y-5">
        <div>
          <label class="label">邮箱地址 / Email</label>
          <input v-model="email" type="email" required autofocus class="input input-mono"
                 placeholder="you@example.com" />
        </div>
        <div>
          <div class="flex items-baseline justify-between">
            <label class="label">密码 / Password</label>
            <a href="#/forgot-password" class="text-2xs text-cinnabar hover:text-cinnabar-deep transition-colors">忘记密码 ?</a>
          </div>
          <input v-model="password" type="password" required class="input input-mono"
                 placeholder="••••••••" />
        </div>

        <div v-if="turnstileSiteKey" :data-sitekey="turnstileSiteKey" class="cf-turnstile pt-1"></div>

        <div class="pt-3">
          <button :disabled="busy" class="btn btn-primary w-full">
            <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">
              {{ busy ? "正在核验…" : "登 入 →" }}
            </span>
          </button>
        </div>
      </form>

      <div class="rule-h mt-7 mb-5"></div>

      <p class="text-center text-sm text-ash">
        尚无账号 ?
        <a href="#/register" class="font-medium text-cinnabar hover:text-cinnabar-deep underline decoration-cinnabar/40">
          创建栖枢档案
        </a>
      </p>
    </div>

    <!-- 底部卷宗号 -->
    <div class="mt-6 flex items-center justify-between">
      <span class="archive-no">QISHU · VOL. I</span>
      <span class="archive-no">— · —</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { loadSession } from "../session.js";
import { navigate } from "../router.js";
import { errToast, okToast } from "../toast.js";

const email = ref("");
const password = ref("");
const busy = ref(false);
const turnstileSiteKey = ref("");

onMounted(async () => {
  try {
    const cfg = await api.get("/auth/turnstile-config");
    if (cfg.enabled && cfg.siteKey) {
      turnstileSiteKey.value = cfg.siteKey;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  } catch {}
});

async function onSubmit() {
  busy.value = true;
  try {
    const tsToken = window.turnstile?.getResponse?.() || "";
    await api.post("/auth/login", {
      email: email.value, password: password.value, turnstileToken: tsToken,
    });
    okToast("登录成功");
    await loadSession();
    navigate("/");
  } catch (e) {
    errToast(e.message);
    if (window.turnstile) window.turnstile.reset();
  } finally {
    busy.value = false;
  }
}
</script>
