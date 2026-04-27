<template>
  <div class="space-y-5">
    <!-- 标题已经由侧边栏给出,这里不再重复"图标缓存"以及说明文案。 -->
    <div class="admin-sticky-head">
      <!-- 工具栏:搜索 + 状态过滤 + 计数 + "抓取未抓取"快捷键(右端)。
           状态四档:有图标 / 抓取失败 / 未抓取(只在卡片表) / 已建缓存但无数据。
           "抓取未抓取" 是管理员第一次进这页最常做的事 —— 把刚加但还没有人触发懒抓
           的卡片图标一键拉起来 —— 所以做成顶级动作而非嵌在 bulk-bar 里。 -->
      <div class="admin-toolbar">
        <input v-model="search" placeholder="搜索 origin / 卡片 / 板块…" class="input admin-search" />
        <select v-model="statusFilter" class="input admin-filter">
          <option value="">全部状态</option>
          <option value="ok">有图标</option>
          <option value="error">抓取失败</option>
          <option value="uncached">未抓取</option>
          <option value="empty">已建缓存但无数据</option>
        </select>
        <span class="admin-count">共 {{ filteredItems.length }} / {{ items.length }} 条</span>
        <button @click="onFetchAllUncached"
                :disabled="bulkBusy || uncachedCount === 0"
                :title="uncachedCount === 0 ? '没有待抓取的卡片' : ''"
                class="btn btn-primary btn-sm admin-action">
          {{ bulkBusy && bulkAction === 'fetch-uncached' ? '抓取中…' : `抓取未抓取 (${uncachedCount})` }}
        </button>
      </div>
    </div>

    <!-- 批量操作:这一页两个动作都有意义 — 批量刷新(订正失败的 origin)+
         批量删除(清掉无引用的 / 出错的 origin)。 -->
    <transition name="bulk">
      <div v-if="selectedCount > 0" class="bulk-bar">
        <span class="bulk-count">已选中 <strong>{{ selectedCount }}</strong> 条</span>
        <button @click="clearSelection" class="btn btn-ghost btn-sm">取消</button>
        <button @click="onBulkRefresh" :disabled="bulkBusy" class="btn btn-secondary btn-sm">
          {{ bulkBusy && bulkAction === 'refresh' ? '刷新中…' : `批量刷新 (${selectedCount})` }}
        </button>
        <button @click="onBulkDelete" :disabled="bulkBusy"
                class="btn btn-secondary btn-sm bulk-danger">
          {{ bulkBusy && bulkAction === 'delete' ? '删除中…' : `批量删除 (${selectedCount})` }}
        </button>
      </div>
    </transition>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 w-10">
                <input type="checkbox" class="bulk-cb"
                       :checked="pageAllChecked" :indeterminate.prop="pageSomeChecked"
                       @change="togglePage($event.target.checked)" />
              </th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-12"></th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Origin</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">关联卡片</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">类型</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">抓取时间</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">错误</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredItems.length === 0">
              <td colspan="8" class="px-4 py-12 text-center text-fg-dim text-sm">
                {{ items.length === 0 ? '暂无' : '没有匹配的图标' }}
              </td>
            </tr>
            <tr v-for="r in pagedItems" :key="r.origin"
                :class="['admin-row', selected[r.origin] && 'admin-row-selected']">
              <td class="px-4 py-3">
                <input type="checkbox" class="bulk-cb"
                       :checked="!!selected[r.origin]"
                       @change="toggleOne(r.origin, $event.target.checked)" />
              </td>
              <td class="px-4 py-3">
                <div class="favicon-wrap">
                  <img v-if="r.hasData" :src="`/api/favicons/image?origin=${encodeURIComponent(r.origin)}`" class="h-5 w-5" alt="" />
                </div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-fg">{{ r.origin }}</td>
              <td class="px-4 py-3">
                <!-- 关联卡片:每张卡片显示 "标题 · 板块",方便管理员看到 origin 实际是哪些卡片在用 -->
                <div v-if="(r.cards || []).length === 0" class="text-xs text-fg-mute italic">
                  (无关联卡片)
                </div>
                <ul v-else class="card-ref-list">
                  <li v-for="(card, idx) in r.cards" :key="idx" class="card-ref">
                    <span class="card-ref-title">{{ card.title }}</span>
                    <span v-if="card.sectionName" class="card-ref-section">· {{ card.sectionName }}</span>
                    <span v-else class="card-ref-section card-ref-section-none">· 未分组</span>
                  </li>
                </ul>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ r.contentType }}</td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ r.cached ? formatTime(r.fetchedAt) : '未抓取' }}</td>
              <td class="px-4 py-3 text-xs text-danger truncate max-w-xs">{{ r.lastError }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="onRefresh(r.origin)"
                        :disabled="(r.cards || []).length === 0"
                        :title="(r.cards || []).length === 0 ? '无关联卡片,无法刷新' : ''"
                        class="btn btn-ghost btn-sm">{{ r.cached ? '刷新' : '抓取' }}</button>
                <!-- 没缓存行就没有可删的对象,藏起来避免 404,也避免管理员误以为
                     "删了卡片就消失" — 真正的卡片删除走"卡片"那一栏。 -->
                <button v-if="r.cached" @click="onDelete(r.origin)"
                        class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredItems.length > 0" class="px-4 py-2">
        <Pagination :total="filteredItems.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";
import { formatTime } from "../../format.js";
import Pagination from "../Pagination.vue";

const items = ref([]);
const page = ref(1);
const search = ref("");
const statusFilter = ref("");
const selected = ref({});           // 这里 key 是 origin(字符串),不是 id
const bulkBusy = ref(false);
const bulkAction = ref("");         // "refresh" | "delete" — 控制按钮 loading 文字
const PAGE_SIZE = 10;

// faviconStatus 四档:
//   ok       — 已成功抓取,有图标
//   error    — 已尝试但失败,缓存表里有 lastError
//   empty    — 缓存表里有空行(失败重试间歇 / 正在抓)
//   uncached — 仅在卡片表里,缓存表无任何记录(管理员刚加的卡 / 没人访问过)
function faviconStatus(r) {
  if (r.hasData) return "ok";
  if (r.lastError) return "error";
  if (!r.cached) return "uncached";
  return "empty";
}

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  const st = statusFilter.value;
  return items.value.filter(r => {
    if (st && faviconStatus(r) !== st) return false;
    if (!q) return true;
    if ((r.origin || "").toLowerCase().includes(q)) return true;
    if ((r.contentType || "").toLowerCase().includes(q)) return true;
    if ((r.lastError || "").toLowerCase().includes(q)) return true;
    for (const card of (r.cards || [])) {
      if ((card.title || "").toLowerCase().includes(q)) return true;
      if ((card.sectionName || "").toLowerCase().includes(q)) return true;
    }
    return false;
  });
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredItems.value.slice(start, start + PAGE_SIZE);
});

watch([search, statusFilter], () => { page.value = 1; });

function clearSelection() { selected.value = {}; }
const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);
// 待抓取计数 — 用于 "抓取未抓取" 按钮的 label 与 disabled 判定。
// 必须有关联卡片(后端会拒绝无引用的 origin),所以两个条件都要满足。
const uncachedCount = computed(() =>
  items.value.filter(r => !r.cached && (r.cards || []).length > 0).length
);
const pageAllChecked = computed(() =>
  pagedItems.value.length > 0 && pagedItems.value.every(r => selected.value[r.origin])
);
const pageSomeChecked = computed(() => {
  const some = pagedItems.value.some(r => selected.value[r.origin]);
  return some && !pageAllChecked.value;
});
function toggleOne(origin, on) {
  if (on) selected.value[origin] = true;
  else delete selected.value[origin];
}
function togglePage(on) {
  for (const r of pagedItems.value) {
    if (on) selected.value[r.origin] = true;
    else delete selected.value[r.origin];
  }
}

async function load() {
  try {
    const r = await api.get("/admin/favicons");
    items.value = r.items || [];
    const origins = new Set(items.value.map(x => x.origin));
    for (const k of Object.keys(selected.value)) {
      if (!origins.has(k)) delete selected.value[k];
    }
  } catch (e) { errToast(e.message); }
}

async function onRefresh(origin) {
  // 区分"首抓"与"刷新":对管理员来说,刚加的卡片这里是第一次抓,
  // toast 提示用"已抓取"更顺;对已有缓存,用"已刷新"。
  const r = items.value.find(x => x.origin === origin);
  const wasCached = !!(r && r.cached);
  try {
    await api.post("/admin/favicons/refresh", { origin });
    okToast(wasCached ? "图标缓存已刷新" : "图标已抓取");
    await load();
  } catch (e) { errToast(e.message); }
}
async function onDelete(origin) {
  const ok = await useConfirm({
    title: "删除图标缓存",
    message: `确认删除该 origin 的图标缓存?`,
    detail: origin,
    kind: "danger",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/favicons/" + encodeURIComponent(origin));
    okToast("图标缓存已删除");
    delete selected.value[origin];
    await load();
  } catch (e) { errToast(e.message); }
}

// 批量刷新 — 不弹确认框,因为刷新是非破坏操作。但要在 toast 上汇报失败数,
// 因为 SSRF / 站点 502 都可能让单条失败。
async function onBulkRefresh() {
  if (bulkBusy.value) return;
  const origins = Object.keys(selected.value).filter(o => selected.value[o]);
  if (origins.length === 0) return;
  // 排除"无关联卡片"的 origin — 后端会拒绝,提前过滤减少噪音
  const refreshable = origins.filter(o => {
    const r = items.value.find(x => x.origin === o);
    return r && (r.cards || []).length > 0;
  });
  const skipped = origins.length - refreshable.length;
  if (refreshable.length === 0) {
    errToast(`选中的 ${origins.length} 条都没有关联卡片,无法刷新`);
    return;
  }

  bulkBusy.value = true;
  bulkAction.value = "refresh";
  let okCount = 0, failCount = 0;
  for (const origin of refreshable) {
    try {
      await api.post("/admin/favicons/refresh", { origin });
      okCount++;
    } catch {
      failCount++;
    }
  }
  bulkBusy.value = false;
  bulkAction.value = "";
  const skipText = skipped > 0 ? ` · 跳过 ${skipped} 条无引用` : "";
  if (failCount === 0) okToast(`已刷新 ${okCount} 条${skipText}`);
  else errToast(`成功 ${okCount} / 失败 ${failCount}${skipText}`);
  await load();
}

async function onBulkDelete() {
  if (bulkBusy.value) return;
  const origins = Object.keys(selected.value).filter(o => selected.value[o]);
  if (origins.length === 0) return;
  // 没有缓存行的 origin 不是"已抓取"过的,DELETE 会 404,先过滤掉。
  // 这是把 "未抓取" 状态的卡片也展示在列表里之后必须做的过滤 —
  // 原版默认每行都有缓存,现在不再成立。
  const deletable = origins.filter(o => {
    const r = items.value.find(x => x.origin === o);
    return r && r.cached;
  });
  const skipped = origins.length - deletable.length;
  if (deletable.length === 0) {
    errToast(`选中的 ${origins.length} 条都未抓取,没有可删除的缓存`);
    return;
  }
  const sample = deletable.slice(0, 5).map(o => "· " + o).join("\n");
  const more = deletable.length > 5 ? `\n…还有 ${deletable.length - 5} 条` : "";
  const skipDetail = skipped > 0 ? `\n\n(跳过 ${skipped} 条未抓取的 origin)` : "";
  const ok = await useConfirm({
    title: "批量删除图标缓存",
    message: `确认删除选中的 ${deletable.length} 条缓存?`,
    detail: "再访问相关卡片时会按需重新抓取。\n\n" + sample + more + skipDetail,
    kind: "danger",
    confirmText: `删除 ${deletable.length} 条`,
  });
  if (!ok) return;

  bulkBusy.value = true;
  bulkAction.value = "delete";
  let okCount = 0, failCount = 0;
  for (const origin of deletable) {
    try {
      await api.delete("/admin/favicons/" + encodeURIComponent(origin));
      delete selected.value[origin];
      okCount++;
    } catch {
      failCount++;
    }
  }
  bulkBusy.value = false;
  bulkAction.value = "";
  const skipText = skipped > 0 ? ` · 跳过 ${skipped} 条未抓取` : "";
  if (failCount === 0) okToast(`已删除 ${okCount} 条${skipText}`);
  else errToast(`成功 ${okCount} / 失败 ${failCount}${skipText}`);
  await load();
}

// 一键抓取所有"未抓取"卡片的图标。无确认框 — 抓取是非破坏操作,
// 串行调用以避免一下子打爆外网或 SSRF 守卫的限流。
async function onFetchAllUncached() {
  if (bulkBusy.value) return;
  const targets = items.value.filter(r => !r.cached && (r.cards || []).length > 0);
  if (targets.length === 0) return;
  bulkBusy.value = true;
  bulkAction.value = "fetch-uncached";
  let okCount = 0, failCount = 0;
  for (const r of targets) {
    try {
      await api.post("/admin/favicons/refresh", { origin: r.origin });
      okCount++;
    } catch {
      failCount++;
    }
  }
  bulkBusy.value = false;
  bulkAction.value = "";
  if (failCount === 0) okToast(`已抓取 ${okCount} 条`);
  else errToast(`成功 ${okCount} / 失败 ${failCount}`);
  await load();
}

onMounted(load);
</script>

<style scoped>
.admin-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.admin-search {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.admin-filter {
  flex-shrink: 0;
  width: auto;
  min-width: 120px;
}
.admin-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--fg-mute);
  white-space: nowrap;
}
.admin-thead {
  border-bottom: 1px solid rgba(15, 36, 25, 0.10);
  background-color: rgba(255, 255, 255, 0.55);
}
.admin-row {
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
  transition: background-color 0.14s;
}
.admin-row:hover {
  background-color: rgba(255, 255, 255, 0.55);
}
.admin-row-selected {
  background-color: rgba(167, 243, 208, 0.30);
}
.admin-row-selected:hover {
  background-color: rgba(167, 243, 208, 0.42);
}
.favicon-wrap {
  height: 28px;
  width: 28px;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(15, 36, 25, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.card-ref-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 320px;
}
.card-ref {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.3;
}
.card-ref-title {
  color: var(--fg);
  font-weight: 500;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-ref-section {
  color: var(--fg-mute);
  font-size: 11px;
  white-space: nowrap;
}
.card-ref-section-none {
  font-style: italic;
  opacity: 0.7;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.42), rgba(110, 231, 183, 0.30));
  border: 1px solid rgba(110, 231, 183, 0.55);
  border-radius: 14px;
  padding: 10px 14px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.bulk-count {
  font-size: 13px;
  color: var(--brand-deep);
}
.bulk-count strong {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700;
  margin: 0 2px;
}
.bulk-danger {
  color: var(--danger) !important;
  border-color: rgba(220, 38, 38, 0.30) !important;
}
.bulk-danger:hover:not(:disabled) {
  background-color: rgba(220, 38, 38, 0.08) !important;
}
.bulk-cb {
  accent-color: var(--brand);
  width: 16px;
  height: 16px;
  cursor: pointer;
  vertical-align: middle;
}

.bulk-enter-active, .bulk-leave-active { transition: all 0.18s cubic-bezier(0.2, 0.8, 0.2, 1); }
.bulk-enter-from, .bulk-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
