<template>
  <div class="space-y-5">
    <header class="admin-tab-head">
      <h1 class="h-page">卡片<span class="text-teal-300">.</span></h1>
      <button @click="openCreate" class="btn btn-primary">+ 新建卡片</button>
    </header>

    <!-- 工具栏:搜索 + 板块筛选 + 计数。
         板块筛选是用户明确要求的"按某个具体板块查看卡片",作为下拉框放在搜索旁。
         "(未分组)" 选项让管理员能快速看到孤儿卡片。 -->
    <div class="admin-toolbar">
      <input v-model="search" placeholder="搜索标题 / URL / 板块…" class="input admin-search" />
      <select v-model="sectionFilter" class="input admin-filter">
        <option value="">全部板块</option>
        <option value="__none__">(未分组)</option>
        <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <span class="admin-count">共 {{ filteredItems.length }} / {{ items.length }} 张</span>
    </div>

    <!-- 批量操作条 — 仅在选中至少一项时出现。删除走逐条 DELETE,后端的
         per-id 校验 / audit 都还在,失败也能逐条报告。 -->
    <transition name="bulk">
      <div v-if="selectedCount > 0" class="bulk-bar">
        <span class="bulk-count">已选中 <strong>{{ selectedCount }}</strong> 张</span>
        <button @click="clearSelection" class="btn btn-ghost btn-sm">取消</button>
        <button @click="onBulkDelete" :disabled="bulkBusy"
                class="btn btn-secondary btn-sm bulk-danger">
          {{ bulkBusy ? '删除中…' : `批量删除 (${selectedCount})` }}
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
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">标题</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">URL</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">板块</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">权限</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-20">排序</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in pagedItems" :key="c.id"
                :class="['admin-row', selected[c.id] && 'admin-row-selected']">
              <td class="px-4 py-3">
                <input type="checkbox" class="bulk-cb"
                       :checked="!!selected[c.id]"
                       @change="toggleOne(c.id, $event.target.checked)" />
              </td>
              <td class="px-4 py-3 font-semibold text-fg">{{ c.title }}</td>
              <td class="px-4 py-3">
                <span class="font-mono text-xs text-fg-dim truncate inline-block max-w-[260px] align-middle" :title="c.url">{{ c.url }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ sectionName(c.sectionId) }}</td>
              <td class="px-4 py-3"><PermissionBadge :value="c.permission" /></td>
              <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ c.order }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(c)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onDelete(c)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
            <tr v-if="filteredItems.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-fg-dim text-sm">
                {{ items.length === 0 ? '暂无卡片' : '没有匹配的卡片' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredItems.length > 0" class="px-4 py-2">
        <Pagination :total="filteredItems.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑卡片' : '新建卡片'">
      <div v-if="editing" class="space-y-4">
        <div><label class="label">标题</label><input v-model="editing.title" class="input" /></div>
        <div><label class="label">URL</label><input v-model="editing.url" class="input input-mono" placeholder="https://..." /></div>
        <div><label class="label">描述 <span class="label-opt">(可选)</span></label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">板块</label>
            <select v-model="editing.sectionId" class="input">
              <option value="">(无)</option>
              <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">访问权限</label>
            <select v-model="editing.permission" class="input">
              <option value="public">公开</option>
              <option value="user">用户</option>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
        <div><label class="label">排序权重</label><input v-model.number="editing.order" type="number" class="input" /></div>
      </div>
      <template #footer>
        <button @click="modalOpen = false" class="btn btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import { useConfirm } from "../../confirm.js";
import Modal from "../Modal.vue";
import Pagination from "../Pagination.vue";
import PermissionBadge from "../PermissionBadge.vue";

const items = ref([]);
const sections = ref([]);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const page = ref(1);
const search = ref("");
const sectionFilter = ref("");        // ""=全部,"__none__"=未分组,其它=具体 sectionId
const selected = ref({});             // { [cardId]: true }
const bulkBusy = ref(false);
const PAGE_SIZE = 10;

const sectionName = (id) => sections.value.find((s) => s.id === id)?.name || (id ? "?" : "—");

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  const sf = sectionFilter.value;
  return items.value.filter(c => {
    // 板块过滤优先 — 如果选了板块,搜索只在该板块内做
    if (sf === "__none__") {
      if (c.sectionId) return false;
    } else if (sf) {
      if (c.sectionId !== sf) return false;
    }
    if (!q) return true;
    return (
      (c.title || "").toLowerCase().includes(q) ||
      (c.url || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q) ||
      sectionName(c.sectionId).toLowerCase().includes(q)
    );
  });
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredItems.value.slice(start, start + PAGE_SIZE);
});

// 搜索 / 板块过滤变化时回到第 1 页 — 否则可能停留在不存在的页码
watch([search, sectionFilter], () => { page.value = 1; });

function clearSelection() { selected.value = {}; }

const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);

// "本页全选"checkbox 的状态:全选 / 部分选 / 都没选
const pageAllChecked = computed(() =>
  pagedItems.value.length > 0 && pagedItems.value.every(c => selected.value[c.id])
);
const pageSomeChecked = computed(() => {
  const some = pagedItems.value.some(c => selected.value[c.id]);
  return some && !pageAllChecked.value;
});

function toggleOne(id, on) {
  if (on) selected.value[id] = true;
  else delete selected.value[id];
}
function togglePage(on) {
  for (const c of pagedItems.value) {
    if (on) selected.value[c.id] = true;
    else delete selected.value[c.id];
  }
}

async function load() {
  try {
    const [c, s] = await Promise.all([api.get("/admin/cards"), api.get("/admin/sections")]);
    items.value = c.items || [];
    sections.value = s.items || [];
    // 加载完之后,把选中状态里指向已不存在 id 的项剔除
    const ids = new Set(items.value.map(x => x.id));
    for (const k of Object.keys(selected.value)) {
      if (!ids.has(k)) delete selected.value[k];
    }
  } catch (e) { errToast(e.message); }
}

function openCreate() { editing.value = { title: "", url: "", description: "", sectionId: "", permission: "public", order: items.value.length }; modalOpen.value = true; }
function openEdit(c) { editing.value = { ...c, sectionId: c.sectionId || "" }; modalOpen.value = true; }

async function onSave() {
  busy.value = true;
  try {
    const body = { ...editing.value };
    if (editing.value.id) {
      await api.patch("/admin/cards/" + editing.value.id, body);
      okToast("卡片已更新");
    } else {
      await api.post("/admin/cards", body);
      okToast("卡片已创建");
    }
    modalOpen.value = false; await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function onDelete(c) {
  const ok = await useConfirm({
    title: "删除卡片",
    message: `确认删除卡片 "${c.title}"?`,
    detail: c.url,
    kind: "danger",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/cards/" + c.id);
    okToast("卡片已删除");
    delete selected.value[c.id];
    await load();
  } catch (e) { errToast(e.message); }
}

// 批量删除:逐条调用 DELETE,把成功/失败分开统计。这样保留了后端的
// 单条审计日志 / 校验,缺点是 N 次 HTTP — 管理员批量操作通常 N 很小,
// 接受这个取舍。
async function onBulkDelete() {
  if (bulkBusy.value) return;
  const ids = Object.keys(selected.value).filter(id => selected.value[id]);
  if (ids.length === 0) return;
  // 把要删的卡片 title 列出几条让管理员二次确认 — 比纯计数安心
  const idSet = new Set(ids);
  const targets = items.value.filter(c => idSet.has(c.id));
  const sample = targets.slice(0, 5).map(c => "· " + c.title).join("\n");
  const more = targets.length > 5 ? `\n…还有 ${targets.length - 5} 张` : "";
  const ok = await useConfirm({
    title: "批量删除卡片",
    message: `确认删除选中的 ${ids.length} 张卡片?`,
    detail: sample + more,
    kind: "danger",
    confirmText: `删除 ${ids.length} 张`,
  });
  if (!ok) return;

  bulkBusy.value = true;
  let okCount = 0, failCount = 0;
  for (const id of ids) {
    try {
      await api.delete("/admin/cards/" + id);
      delete selected.value[id];
      okCount++;
    } catch {
      failCount++;
    }
  }
  bulkBusy.value = false;
  if (failCount === 0) okToast(`已删除 ${okCount} 张`);
  else errToast(`成功 ${okCount} / 失败 ${failCount}`);
  await load();
}

onMounted(load);
</script>

<style scoped>
.admin-tab-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
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
  min-width: 140px;
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
.label-opt {
  color: var(--fg-mute);
  font-weight: normal;
  font-size: 11px;
  letter-spacing: normal;
  margin-left: 4px;
  text-transform: none;
}

/* 批量操作条 — 统一样式。"已选中"提示用品牌绿(选择 ≠ 警告),
   "批量删除"按钮单独是 danger 色,提醒不可逆。 */
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
  margin-left: auto;
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
