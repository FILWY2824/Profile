<template>
  <div class="space-y-5 pb-24">
    <!-- 顶部:页标题 + 副标题(全宽,与其它 tab 一致),不再放在左侧栏里。 -->
    <header>
      <h1 class="h-page">系统设置<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim text-[15px] mt-2">所有改动只对新会话生效;部分项保存后立即热重载</p>
    </header>

    <div v-if="loading" class="surface p-12 text-center text-fg-dim text-sm">
      <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine mr-2 align-middle"></span>
      加载中
    </div>

    <template v-else>
      <!-- 顶部 filter bar:搜索 + 分类胶囊 + 计数。
           分类原本是侧栏纵向列表,现在改横向 — 这样移动端、宽屏都更省空间,
           也跟其它 tab 的 admin-toolbar 视觉一致。胶囊按 active 高亮,带 count
           小角标,悬停态从侧栏样式移植过来。 -->
      <div class="settings-toolbar">
        <input v-model="search" placeholder="搜索键名 / 描述…" class="input settings-search" />
        <div class="cat-pill-row">
          <button @click="activeCategory = 'all'"
                  :class="['cat-pill', activeCategory === 'all' && 'cat-pill-active']">
            <span>全部</span>
            <span class="cat-pill-count">{{ items.length }}</span>
          </button>
          <button v-for="c in categories" :key="c.key"
                  @click="activeCategory = c.key"
                  :class="['cat-pill', activeCategory === c.key && 'cat-pill-active']">
            <span class="cat-pill-icon">{{ c.icon }}</span>
            <span>{{ c.label }}</span>
            <span class="cat-pill-count">{{ c.count }}</span>
          </button>
        </div>
        <span class="settings-count">共 {{ filteredItems.length }} / {{ items.length }} 项</span>
      </div>

      <!-- 已修改提示横条 — 原版藏在侧栏底,现在直接顶在设置列表上方,
           因为底部已经有 floating-save-bar,这里再放具体 key 列表帮助管理员
           对照"我到底改了哪几行"。 -->
      <div v-if="modifiedKeys.length > 0" class="modified-banner">
        <div class="modified-banner-head">
          <span class="badge-amber">{{ modifiedKeys.length }} 项未保存</span>
          <span class="text-[11px] text-fg-mute">改动列表 (鼠标悬停查看完整 key)</span>
        </div>
        <ul class="modified-banner-keys">
          <li v-for="k in modifiedKeys.slice(0, 12)" :key="k" :title="k">{{ k }}</li>
          <li v-if="modifiedKeys.length > 12" class="modified-banner-more">…还有 {{ modifiedKeys.length - 12 }}</li>
        </ul>
      </div>

      <!-- 设置列表 — 行布局保持原版的 1+2 列网格 -->
      <div v-if="filteredItems.length === 0" class="surface p-8 text-center text-fg-dim text-sm">
        没有匹配的设置项
      </div>
      <div v-else class="space-y-3">
        <div v-for="row in filteredItems" :key="row.key"
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

      <!-- 数据保留 / 一键清理 — 用户要求从侧栏移到主区。放在设置列表最下方,
           因为它是破坏性操作,不应该抢在普通设置之前夺走视线。
           用单独 surface 卡片 + 显眼的小标题与说明,内部仍是"复选 + 单清/批清"
           的双模式。 -->
      <section class="retention-section">
        <div class="retention-head">
          <div>
            <h2 class="h-section">
              数据保留 · 一键清理<span class="ic-accent">⌫</span>
            </h2>
            <p class="text-fg-dim text-sm mt-1.5">
              勾选后点 "清理选中" 一次性清掉勾选项;也可以单独点每行的 "清理"。
              <span class="text-warn-700">操作不可逆。</span>
            </p>
          </div>
        </div>

        <div class="surface retention-card">
          <ul class="retention-list">
            <li v-for="t in pruneTargets" :key="t.key"
                :class="['retention-row', pruneSelected[t.key] && 'retention-row-on']">
              <label class="retention-label">
                <input type="checkbox" v-model="pruneSelected[t.key]" :disabled="pruneBusy" class="bulk-cb" />
                <span class="retention-name">{{ t.label }}</span>
              </label>
              <button @click="pruneOne(t.key)" :disabled="pruneBusy"
                      class="btn btn-ghost btn-sm">清理</button>
            </li>
          </ul>

          <div class="retention-footer">
            <button @click="selectAllPrune(true)" class="text-[12px] text-fg-dim hover:text-fg">全选</button>
            <span class="text-fg-mute text-[12px]">·</span>
            <button @click="selectAllPrune(false)" class="text-[12px] text-fg-dim hover:text-fg">清空</button>
            <button @click="pruneBatch" :disabled="pruneBusy || pruneSelectedCount === 0"
                    class="btn btn-secondary btn-sm ml-auto bulk-danger">
              {{ pruneBusy ? '清理中…' : `清理选中 (${pruneSelectedCount})` }}
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- Floating save bar — 位置 / 视觉与原版一致 -->
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

// ─── 数据保留 / 清理目标(原本在侧栏,现在移到主区底部)───────────────
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
const pruneSelectedCount = computed(() => pruneTargets.filter(t => pruneSelected.value[t.key]).length);
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
/* 顶部工具条 — 与其它 tab 风格一致(input + 横向胶囊 + count) */
.settings-toolbar {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.settings-search {
  flex: 0 0 260px;
  max-width: 100%;
}
.settings-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--fg-mute);
  white-space: nowrap;
  align-self: center;
  margin-left: auto;
}

/* 分类胶囊行 — 横向滚动以适配窄屏。 */
.cat-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 320px;
  min-width: 0;
}
.cat-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-dim);
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.75);
  transition: all 0.14s ease;
  cursor: pointer;
  white-space: nowrap;
}
.cat-pill:hover {
  color: var(--fg);
  background-color: rgba(255, 255, 255, 0.85);
}
.cat-pill-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857) !important;
  color: #fff !important;
  border-color: transparent !important;
  font-weight: 600;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 4px 10px -3px rgba(16, 185, 129, 0.45);
}
.cat-pill-icon {
  font-size: 13px;
  line-height: 1;
}
.cat-pill-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 600;
  opacity: 0.7;
  margin-left: 2px;
}
.cat-pill-active .cat-pill-count {
  opacity: 0.85;
}

/* 已修改提示横条 — 比侧栏内的"未保存堆叠"信息密度高一点 */
.modified-banner {
  background-color: rgba(254, 243, 199, 0.55);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 14px;
  padding: 12px 14px;
}
.modified-banner-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.modified-banner-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: #92400E;
}
.modified-banner-keys li {
  background-color: rgba(254, 243, 199, 0.85);
  border: 1px solid rgba(217, 119, 6, 0.32);
  border-radius: 6px;
  padding: 2px 7px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modified-banner-more {
  background-color: transparent !important;
  border-color: transparent !important;
  font-style: italic;
  opacity: 0.7;
}

.setting-row-modified {
  border-color: rgba(217, 119, 6, 0.40) !important;
  background-color: rgba(254, 243, 199, 0.45) !important;
}

/* 数据保留 / 一键清理 卡片 — 在主区底部独立成节 */
.retention-section {
  margin-top: 8px;
  padding-top: 24px;
  border-top: 1px dashed rgba(15, 36, 25, 0.10);
}
.retention-head {
  margin-bottom: 12px;
}
.ic-accent {
  font-style: italic;
  font-weight: 500;
  margin-left: 6px;
  color: var(--brand);
}
.text-warn-700 { color: #B45309; font-weight: 500; }

.retention-card {
  padding: 6px 6px 10px;
}
.retention-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}
@media (min-width: 768px) {
  .retention-list { grid-template-columns: 1fr 1fr; }
}

.retention-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background-color 0.14s;
}
.retention-row:hover {
  background-color: rgba(255, 255, 255, 0.55);
}
.retention-row-on {
  background-color: rgba(167, 243, 208, 0.30);
}
.retention-row-on:hover {
  background-color: rgba(167, 243, 208, 0.42);
}
.retention-label {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  cursor: pointer;
  font-size: 13px;
  color: var(--fg);
  min-width: 0;
}
.retention-name {
  flex: 1;
  min-width: 0;
}

.retention-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 4px;
  border-top: 1px solid rgba(15, 36, 25, 0.06);
  margin-top: 4px;
}
.bulk-cb {
  accent-color: var(--brand);
  width: 16px;
  height: 16px;
  cursor: pointer;
  vertical-align: middle;
  flex-shrink: 0;
}
.bulk-danger {
  color: var(--danger) !important;
  border-color: rgba(220, 38, 38, 0.30) !important;
}
.bulk-danger:hover:not(:disabled) {
  background-color: rgba(220, 38, 38, 0.08) !important;
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
