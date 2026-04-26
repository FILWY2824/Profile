// useTurnstile.js — Cloudflare Turnstile 的 Vue Composable。
//
// 旧实现只是把 .cf-turnstile div 丢进 DOM,提交时再 getResponse(),靠隐式
// 自动渲染。问题:
//   - 用户没注意到 widget 还在加载/挑战中,直接点提交 -> token 为空 ->
//     服务端 400("人机验证失败") -> 用户重试,但因为表单还没拿到
//     Turnstile 的 callback,这次 getResponse 仍然空,继续 400。
//   - token 过期了(默认 300s),用户没看见 widget 状态变化,继续提交,
//     还是 400。
//
// 新实现:
//   - explicit 模式 render,通过 callback / expired-callback / error-callback
//     主动管理 token 状态。
//   - 暴露 canSubmit:Turnstile 关闭时恒 true,开启时必须有 token 才返回 true,
//     页面把它绑到提交按钮的 :disabled。
//   - 失败一次自动 reset,用户感知是"再点一次马上能过"而不是"点了好多次都失败"。
//   - 组件卸载时显式 turnstile.remove,避免 SPA 切换页面后残留 widget。

import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../api.js";

const TURNSTILE_SCRIPT_BASE = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const READY_CB_NAME = "__qishuTurnstileReady";

// 全局缓存 script 加载 promise,SPA 内多次进出登录/注册页时不重复挂 <script>。
let scriptPromise = null;
function loadTurnstileScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    // 之前页面残留的 script 标签直接复用
    const existing = document.querySelector(`script[src^="${TURNSTILE_SCRIPT_BASE}"]`);
    if (existing) {
      if (window.turnstile) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = `${TURNSTILE_SCRIPT_BASE}?onload=${READY_CB_NAME}`;
    s.async = true;
    s.defer = true;
    window[READY_CB_NAME] = () => resolve();
    s.onerror = () => reject(new Error("turnstile script load failed"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * useTurnstile 返回:
 *   - container: 绑到一个 <div ref="container"></div> 上,Turnstile 渲染到这里
 *   - siteKey: 后端返回的公钥(空字符串时表示未启用)
 *   - enabled: 是否启用(布尔)
 *   - token: 用户验证后拿到的一次性 token(失败/过期会自动清空)
 *   - canSubmit: 表单提交按钮的 :disabled 反值;true=可点
 *   - reset(): 服务端拒绝后调用,清掉旧 token 重新挑战
 */
export function useTurnstile() {
  const container = ref(null);
  const siteKey = ref("");
  const enabled = ref(false);
  const token = ref("");
  const loaded = ref(false);
  let widgetId = null;

  const canSubmit = computed(() => {
    if (!enabled.value) return true;
    return token.value !== "";
  });

  function render() {
    if (!window.turnstile || !container.value || !siteKey.value) return;
    if (widgetId !== null) {
      try { window.turnstile.remove(widgetId); } catch { /* noop */ }
      widgetId = null;
    }
    widgetId = window.turnstile.render(container.value, {
      sitekey: siteKey.value,
      callback: (t) => { token.value = t || ""; },
      "expired-callback": () => {
        token.value = "";
        try { window.turnstile.reset(widgetId); } catch { /* noop */ }
      },
      "error-callback": () => {
        token.value = "";
        // 出错后自动 reset 一次,大多数情况(网络抖动/边缘节点临时拒绝)
        // 重试一次就过。我们不无限循环,失败就让用户感知。
        try { window.turnstile.reset(widgetId); } catch { /* noop */ }
      },
      theme: "light",
    });
    loaded.value = true;
  }

  function reset() {
    token.value = "";
    if (window.turnstile && widgetId !== null) {
      try { window.turnstile.reset(widgetId); } catch { /* noop */ }
    }
  }

  onMounted(async () => {
    try {
      const cfg = await api.get("/auth/turnstile-config");
      if (cfg.enabled && cfg.siteKey) {
        enabled.value = true;
        siteKey.value = cfg.siteKey;
        try {
          await loadTurnstileScript();
          // 等下一帧让 ref 挂上 DOM
          requestAnimationFrame(render);
        } catch (e) {
          // Turnstile 脚本加载失败不阻塞页面,服务端会兜底拒绝;
          // 在控制台留个 warn 让运维看到。
          // eslint-disable-next-line no-console
          console.warn("[turnstile] script load failed:", e);
        }
      }
    } catch { /* /auth/turnstile-config 失败时静默,不影响表单显示 */ }
  });

  onUnmounted(() => {
    if (widgetId !== null && window.turnstile) {
      try { window.turnstile.remove(widgetId); } catch { /* noop */ }
      widgetId = null;
    }
  });

  return { container, siteKey, enabled, token, loaded, canSubmit, reset };
}
