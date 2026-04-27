<template>
  <div class="space-y-5">
    <!-- 标题已经由侧边栏给出。"+ 新建板块" 并入 toolbar 末尾。 -->
    <div class="admin-sticky-head">
      <!-- 板块这一页"按板块过滤"是循环 — 板块本身就是分组维度,所以只放搜索框,
           不再画"全部板块"那种下拉。这里的 admin-toolbar 与 CardsTab 同款样式
           保持一致,但少一个 select。 -->
      <div class="admin-toolbar">
        <input v-model="search" placeholder="搜索名称 / slug / 描述…" class="input admin-search" />
        <span class="admin-count">共 {{ filteredItems.length }} / {{ items.length }} 个</span>
        <button @click="openCreate" class="btn btn-primary admin-action">+ 新建板块</button>
      </div>
    </div>

    <transition name="bulk">
      <div v-if="selectedCount > 0" class="bulk-bar">
        <span class="bulk-count">已选中 <strong>{{ selectedCount }}</strong> 个</span>
        <button @click="clearSelection" class="btn btn-ghost btn-sm">取消</button>
        <button @click="onBulkDelete" :disabled="bulkBusy"
                class="btn btn-secondary btn-sm bulk-danger">
          {{ bulkBusy ? '删除中…' : `批量删除 (${selectedCount})` }}
        </button>
      </div>
    </transition>

    <div class="surface overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="admin-thead">
            <th class="px-4 py-3 w-10">
              <input type="checkbox" class="bulk-cb"
                     :checked="pageAllChecked" :indeterminate.prop="pageSomeChecked"
                     @change="togglePage($event.target.checked)" />
            </th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">名称</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Slug</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">描述</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-20">排序</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in pagedItems" :key="s.id"
              :class="['admin-row', selected[s.id] && 'admin-row-selected']">
            <td class="px-4 py-3">
              <input type="checkbox" class="bulk-cb"
                     :checked="!!selected[s.id]"
                     @change="toggleOne(s.id, $event.target.checked)" />
            </td>
            <td class="px-4 py-3 font-semibold text-fg">{{ s.name }}</td>
            <td class="px-4 py-3 text-xs font-mono text-fg-dim">{{ s.slug }}</td>
            <td class="px-4 py-3 text-xs text-fg-dim truncate max-w-xs">{{ s.description }}</td>
            <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ s.order }}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <button @click="openEdit(s)" class="btn btn-ghost btn-sm">编辑</button>
              <button @click="onDelete(s)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
            </td>
          </tr>
          <tr v-if="filteredItems.length === 0">
            <td colspan="6" class="px-4 py-12 text-center text-fg-dim text-sm">
              {{ items.length === 0 ? '暂无板块' : '没有匹配的板块' }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredItems.length > 0" class="px-4 py-2">
        <Pagination :total="filteredItems.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑板块' : '新建板块'">
      <div v-if="editing" class="space-y-4">
        <div><label class="label">名称</label><input v-model="editing.name" class="input" /></div>
        <div><label class="label">Slug (字母数字短横线)</label><input v-model="editing.slug" class="input input-mono" /></div>
        <div><label class="label">描述 <span class="label-opt">(可选)</span></label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div><label class="label">排序权重 (小的靠前)</label><input v-model.number="editing.order" type="number" class="input" /></div>
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

const items = ref([]);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const page = ref(1);
const search = ref("");
const selected = ref({});
const bulkBusy = ref(false);
const PAGE_SIZE = 10;

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter(s =>
    (s.name || "").toLowerCase().includes(q) ||
    (s.slug || "").toLowerCase().includes(q) ||
    (s.description || "").toLowerCase().includes(q));
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredItems.value.slice(start, start + PAGE_SIZE);
});

watch(search, () => { page.value = 1; });

function clearSelection() { selected.value = {}; }
const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);
const pageAllChecked = computed(() =>
  pagedItems.value.length > 0 && pagedItems.value.every(s => selected.value[s.id])
);
const pageSomeChecked = computed(() => {
  const some = pagedItems.value.some(s => selected.value[s.id]);
  return some && !pageAllChecked.value;
});
function toggleOne(id, on) {
  if (on) selected.value[id] = true;
  else delete selected.value[id];
}
function togglePage(on) {
  for (const s of pagedItems.value) {
    if (on) selected.value[s.id] = true;
    else delete selected.value[s.id];
  }
}

async function load() {
  try {
    const r = await api.get("/admin/sections");
    items.value = r.items || [];
    const ids = new Set(items.value.map(x => x.id));
    for (const k of Object.keys(selected.value)) {
      if (!ids.has(k)) delete selected.value[k];
    }
  } catch (e) { errToast(e.message); }
}
function openCreate() { editing.value = { name: "", slug: "", description: "", order: items.value.length }; modalOpen.value = true; }
function openEdit(s) { editing.value = { ...s }; modalOpen.value = true; }
async function onSave() {
  busy.value = true;
  try {
    if (editing.value.id) {
      await api.patch("/admin/sections/" + editing.value.id, editing.value);
      okToast("板块已更新");
    } else {
      await api.post("/admin/sections", editing.value);
      okToast("板块已创建");
    }
    modalOpen.value = false; await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}
async function onDelete(s) {
  const ok = await useConfirm({
    title: "删除板块",
    message: `确认删除板块 "${s.name}"?`,
    detail: "板块内的卡片不会被删除,但会变为无所属(显示在「其他」分组)。",
    kind: "danger",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/sections/" + s.id);
    okToast("板块已删除");
    delete selected.value[s.id];
    await load();
  } catch (e) { errToast(e.message); }
}

async function onBulkDelete() {
  if (bulkBusy.value) return;
  const ids = Object.keys(selected.value).filter(id => selected.value[id]);
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const targets = items.value.filter(s => idSet.has(s.id));
  const sample = targets.slice(0, 5).map(s => "· " + s.name).join("\n");
  const more = targets.length > 5 ? `\n…还有 ${targets.length - 5} 个` : "";
  const ok = await useConfirm({
    title: "批量删除板块",
    message: `确认删除选中的 ${ids.length} 个板块?`,
    detail: "板块内的卡片不会被删除,但会变为无所属。\n\n" + sample + more,
    kind: "danger",
    confirmText: `删除 ${ids.length} 个`,
  });
  if (!ok) return;

  bulkBusy.value = true;
  let okCount = 0, failCount = 0;
  for (const id of ids) {
    try {
      await api.delete("/admin/sections/" + id);
      delete selected.value[id];
      okCount++;
    } catch {
      failCount++;
    }
  }
  bulkBusy.value = false;
  if (failCount === 0) okToast(`已删除 ${okCount} 个`);
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
  min-width: 240px;
  max-width: 420px;
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
