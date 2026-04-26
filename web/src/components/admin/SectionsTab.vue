<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="h-page">板块管理<span class="text-teal-300">.</span></h1>
        <p class="text-fg-dim text-sm mt-1.5">{{ items.length }} 个板块</p>
      </div>
      <button @click="openCreate" class="btn btn-primary">+ 新建板块</button>
    </header>

    <div class="surface overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="admin-thead">
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">名称</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Slug</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">描述</th>
            <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider w-20">排序</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in pagedItems" :key="s.id" class="admin-row">
            <td class="px-4 py-3 font-semibold text-fg">{{ s.name }}</td>
            <td class="px-4 py-3 text-xs font-mono text-fg-dim">{{ s.slug }}</td>
            <td class="px-4 py-3 text-xs text-fg-dim truncate max-w-xs">{{ s.description }}</td>
            <td class="px-4 py-3 text-xs text-fg-dim font-mono">{{ s.order }}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <button @click="openEdit(s)" class="btn btn-ghost btn-sm">编辑</button>
              <button @click="onDelete(s)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无板块</td>
          </tr>
        </tbody>
      </table>
      <div v-if="items.length > 0" class="px-4 py-2">
        <Pagination :total="items.length" v-model:current-page="page" :page-size="10" />
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
import { ref, computed, onMounted } from "vue";
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
const PAGE_SIZE = 10;

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return items.value.slice(start, start + PAGE_SIZE);
});

async function load() {
  try {
    const r = await api.get("/admin/sections");
    items.value = r.items || [];
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
    await load();
  } catch (e) { errToast(e.message); }
}
onMounted(load);
</script>

<style scoped>
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
.label-opt {
  color: var(--fg-mute);
  font-weight: normal;
  font-size: 11px;
  letter-spacing: normal;
  margin-left: 4px;
  text-transform: none;
}
</style>
