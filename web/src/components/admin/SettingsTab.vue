<template>
  <div class="space-y-6 pb-24">
    <div v-if="loading" class="surface p-12 text-center text-fg-dim text-sm">
      <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine mr-2 align-middle"></span>
      加载中
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-5">
      <!-- 左:固定的子侧栏 - 标题/副标题在最上方,搜索框、分类、未保存堆叠、
           数据保留(prune 工具)依次往下。整页不再有顶部的大 H1。 -->
      <aside class="lg:sticky lg:top-0 lg:self-start space-y-3 settings-side">
        <div class="settings-side-head">
          <h2 class="settings-side-title">系统设置<span class="text-teal-300">.</span></h2>
          <p class="settings-side-sub">所有改动只对新会话生效;部分项保存后立即热重载</p>
        </div>

        <input v-model="search" placeholder="搜索键名 / 描述…" class="input" />

        <div class="surface p-2 space-y-0.5">
          <button @click="activeCategory = 'all'"
                  :class="['tab-pill', activeCategory === 'all' && 'tab-pill-active']">
            <span>全部</span>
            <span class="ml-auto text-xs opacity-70">{{ items.length }}</span>
          </button>
          <button v-for="c in categories" :key="c.key"
                  @click="activeCategory = c.key"
                  :class="['tab-pill', activeCategory === c.key && 'tab-pill-active']">
            <span>{{ c.icon }}</span>
            <span>{{ c.label }}</span>
            <span class="ml-auto text-xs opacity-70">{{ c.count }}</span>
          </button>
        </div>

        <div v-if="modifiedKeys.length > 0" class="settings-modified-pile">
          <div class="text-xs text-warn font-semibold">{{ modifiedKeys.length }} 项未保存</div>
          <ul class="text-[11px] font-mono mt-1.5 space-y-0.5 max-h-32 overflow-y-auto" style="color: #B45309">
            <li v-for="k in modifiedKeys.slice(0, 8)" :key="k">{{ k }}</li>
            <li v-if="modifiedKeys.length > 8" class="opacity-70">…还有 {{ modifiedKeys.length - 8 }} 项</li>
          </ul>
        </div>

        <!-- 数据保留 / 一键清理 — 用户要求:可以勾选具体内容批量清理。
             单选清理可继续点每行的 "清理" 按钮,批量则用上方多选 + "清理选中" -->
        <div class="surface p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-fg uppercase tracking-wider">数据保留 · 一键清理</span>
          </div>
          <p class="text-[11px] text-fg-mute leading-relaxed">
            勾选后点 "清理选中" 一次清掉全部勾选项;也可以单独点每行的清理按钮。
          </p>
          <ul class="space-y-1.5">
            <li v-for="t in pruneTargets" :key="t.key" class="prune-row">
              <label class="prune-label">
                <input type="checkbox" v-model="pruneSelected[t.key]" :disabled="pruneBusy" />
                <span class="prune-name">{{ t.label }}</span>
              </label>
              <button @click="pruneOne(t.key)" :disabled="pruneBusy"
                      class="btn btn-ghost btn-sm">清理</button>
            </li>
          </ul>
          <div class="flex items-center gap-2 pt-1">
            <button @click="selectAllPrune(true)" class="text-[11px] text-fg-dim hover:text-fg">全选</button>
            <span class="text-fg-mute text-[11px]">·</span>
            <button @click="selectAllPrune(false)" class="text-[11px] text-fg-dim hover:text-fg">清空</button>
            <button @click="pruneBatch" :disabled="pruneBusy || selectedCount === 0"
                    class="btn btn-secondary btn-sm ml-auto">
              {{ pruneBusy ? '清理中…' : `清理选中 (${selectedCount})` }}
            </button>
          </div>
        </div>
      </aside>

      <!-- Settings list -->
      <div class="space-y-3">
        <div v-if="filteredItems.length === 0" class="surface p-8 text-center text-fg-dim text-sm">
          没有匹配的设置项
        </div>

        <div v-else
             v-for="row in filteredItems" :key="row.key"
             :class="['surface p-4 transition-colors', isModified(row.key) && 'setting-row-modified']">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-5 md:items-start">
            <div class="md:pr-2">
              <div class="flex items-center gap-2 flex-wrap">
                <code class="text-xs font-mono font-semibold text-fg">{{ row.key }}</code>
                <span v-if="row.sensitive" class="badge-amber">敏感</span>
                <span v-if="isModified(row.key)" class="badge-accent">已修改</span>
                <span v-if="isHotReload(row.key)" class="badge-emerald" title="保存后立即生效">热加载</span>
              </div>
              <p class="text-xs text-fg-dim mt-1.5 leading-relaxed">{{ row.description || '—' }}</p>
            </div>

            <div class="md:col-span-2">
              <select v-if="row.key === 'TURNSTILE_ENABLED' || row.key === 'TURNSTILE_SEND_REMOTEIP'"
                      v-model="dirty[row.key]" class="input">
                <option value="1">启用 (1)</option>
                <option value="0">关闭 (0)</option>
              </select>
              <textarea v-else-if="row.value && row.value.length > 80"
                        v-model="dirty[row.key]" rows="3" class="input input-mono"></textarea>
              <input v-else
                     v-model="dirty[row.key]"
                     :type="row.sensitive ? 'password' : 'text'"
                     class="input input-mono" />

              <div v-if="isModified(row.key)" class="mt-2 flex items-center gap-2 text-[11px]">
                <span class="text-fg-mute">原值:</span>
                <code class="text-fg-dim font-mono truncate">{{ row.value || '(空)' }}</code>
                <button @click="resetKey(row.key)" class="ml-auto text-teal-300 hover:underline">还原</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Floating save bar -->
    <transition name="bar">
      <div v-if="modifiedKeys.length > 0" class="floating-save-bar">
        <div class="text-sm">
          <span class="font-semibold text-fg">{{ modifiedKeys.length }}</span>
          <span class="text-fg-dim"> 项未保存</span>
        </div>
        <div class="h-4 w-px" style="background: rgba(15, 36, 25, 0.16)"></div>
        <button @click="resetAll" class="btn btn-ghost btn-sm">全部还原</button>
        <button @click="save" :disabled="busy" class="btn btn-primary btn-sm">{{ busy ? "保存中…" : "保存修改" }}</button>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";

const items = ref([]);
const dirty = ref({});
const loading = ref(true);
const busy = ref(false);
const search = ref("");
const activeCategory = ref("all");

const categoryMeta = {
  general: { icon: "🏠", label: "通用" },
  auth: { icon: "🔐", label: "鉴权" },
  email: { icon: "📧", label: "邮件" },
  verification: { icon: "✉️", label: "验证码" },
  oauth: { icon: "🔑", label: "OAuth" },
  retention: { icon: "🗑️", label: "数据保留" },
  ratelimit: { icon: "⏱️", label: "限流" },
  security: { icon: "🛡️", label: "安全" },
};

const hotReloadKeys = new Set([
  "TURNSTILE_ENABLED", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SEND_REMOTEIP",
  "RESEND_API_KEY", "RESEND_FROM",
]);
function isHotReload(k) { return hotReloadKeys.has(k); }

// ─── 数据保留 / 清理目标 ──────────────────────────────────────────────
// 之前只有 2 项,实际可清理的内容远不止两项。把 vcodes/pending 这种短期表
// 也暴露出来,加上 favicons / oauth-codes / oauth-tokens-expired,共 7 个目标。
const pruneTargets = [
  { key: "vcodes",               label: "过期验证码 (vcodes)" },
  { key: "pending",              label: "过期待注册 (pending)" },
  { key: "login-history",        label: "登录历史 (按保留天数)" },
  { key: "activity-log",         label: "活动日志 (按保留天数)" },
  { key: "oauth-codes",          label: "过期 OAuth 授权码" },
  { key: "oauth-tokens-expired", label: "过期 OAuth token" },
  { key: "favicons",             label: "全部图标缓存" },
];
const pruneSelected = ref({});
const pruneBusy = ref(false);
const selectedCount = computed(() => pruneTargets.filter(t => pruneSelected.value[t.key]).length);
function selectAllPrune(v) {
  for (const t of pruneTargets) pruneSelected.value[t.key] = v;
}

const categories = computed(() => {
  const counts = {};
  for (const i of items.value) counts[i.category] = (counts[i.category] || 0) + 1;
  const out = [];
  for (const k of Object.keys(counts).sort()) {
    out.push({ key: k, label: categoryMeta[k]?.label || k, icon: categoryMeta[k]?.icon || "•", count: counts[k] });
  }
  return out;
});

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((i) => {
    if (activeCategory.value !== "all" && i.category !== activeCategory.value) return false;
    if (!q) return true;
    return (
      i.key.toLowerCase().includes(q) ||
      (i.description || "").toLowerCase().includes(q)
    );
  });
});

const modifiedKeys = computed(() =>
  items.value.filter((i) => dirty.value[i.key] !== i.value).map((i) => i.key)
);

function isModified(k) { return modifiedKeys.value.includes(k); }

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/admin/settings");
    items.value = r.items || [];
    resetAll();
  } catch (e) {
    errToast(e.message);
  } finally {
    loading.value = false;
  }
}

function resetAll() {
  dirty.value = Object.fromEntries(items.value.map((i) => [i.key, i.value]));
}
function resetKey(k) {
  const orig = items.value.find((i) => i.key === k);
  if (orig) dirty.value[k] = orig.value;
}

async function save() {
  const updates = items.value
    .filter((i) => dirty.value[i.key] !== i.value)
    .map((i) => ({ key: i.key, value: dirty.value[i.key] }));
  if (updates.length === 0) {
    okToast("无变更");
    return;
  }
  busy.value = true;
  try {
    await api.patch("/admin/settings", { updates });
    okToast(`已保存 ${updates.length} 项`);
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function pruneOne(table) {
  const target = pruneTargets.find(t => t.key === table);
  const ok = await useConfirm({
    title: "清理数据",
    message: `确认清理 "${target?.label || table}"?`,
    detail: "已被清理的数据无法恢复。",
    kind: "danger",
    confirmText: "立即清理",
  });
  if (!ok) return;
  try {
    const r = await api.post(`/admin/retention/${table}/prune`);
    okToast(`已清理 ${r.removed ?? 0} 条 (${target?.label || table})`);
  } catch (e) { errToast(e.message); }
}

async function pruneBatch() {
  if (pruneBusy.value) return;
  const sel = pruneTargets.filter(t => pruneSelected.value[t.key]);
  if (sel.length === 0) return;
  const ok = await useConfirm({
    title: "批量清理",
    message: `确认一键清理勾选的 ${sel.length} 类数据?`,
    detail: sel.map(t => "· " + t.label).join("\n"),
    kind: "danger",
    confirmText: `清理 ${sel.length} 类`,
  });
  if (!ok) return;
  pruneBusy.value = true;
  let totalRemoved = 0;
  let okCount = 0;
  let failCount = 0;
  for (const t of sel) {
    try {
      const r = await api.post(`/admin/retention/${t.key}/prune`);
      totalRemoved += (r.removed || 0);
      okCount++;
    } catch (e) {
      failCount++;
      // 不打断整批,只在 toast 上报告失败次数
      // eslint-disable-next-line no-console
      console.warn(`prune ${t.key} failed:`, e.message);
    }
  }
  pruneBusy.value = false;
  if (failCount === 0) {
    okToast(`已清理 ${okCount} 类、共 ${totalRemoved} 条`);
  } else {
    errToast(`完成 ${okCount} / 失败 ${failCount} · 共清理 ${totalRemoved} 条`);
  }
}

onMounted(load);
</script>

<style scoped>
.settings-side {
  /* 给侧栏一个稳定背景层级 */
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.settings-side-head {
  padding: 4px 8px 8px;
}
.settings-side-title {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.022em;
  color: var(--fg);
  line-height: 1.1;
  font-variation-settings: "opsz" 36;
}
.settings-side-sub {
  font-size: 11.5px;
  color: var(--fg-dim);
  margin-top: 6px;
  line-height: 1.45;
}

.settings-modified-pile {
  background-color: rgba(254, 243, 199, 0.55);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 16px;
  padding: 12px;
}
.setting-row-modified {
  border-color: rgba(217, 119, 6, 0.40) !important;
  background-color: rgba(254, 243, 199, 0.45) !important;
}

/* prune 行 */
.prune-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prune-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg-dim);
}
.prune-label input[type="checkbox"] {
  accent-color: var(--brand);
  flex-shrink: 0;
}
.prune-name {
  flex: 1;
  min-width: 0;
}

.floating-save-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  background-color: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 18px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.85) inset,
    0 12px 32px -8px rgba(15, 36, 25, 0.18);
}

.bar-enter-active, .bar-leave-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translate(-50%, 20px); }
</style>
