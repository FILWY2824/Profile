<template>
  <div class="space-y-5">
    <!-- 标题已经由侧边栏给出。"+ 新建客户端" 并入 toolbar 末尾。 -->
    <div class="admin-sticky-head">
      <!-- 工具栏:搜索 + 状态(active/disabled)+ 计数 + 新建。
           这里的状态本身就是 OAuth 客户端最常用的"找下被关掉的应用"维度,
           加这个 filter 比强行给搜索加 status: 前缀更直接。 -->
      <div class="admin-toolbar">
        <input v-model="search" placeholder="搜索名称 / Client ID / 描述…" class="input admin-search" />
        <select v-model="statusFilter" class="input admin-filter">
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
        <span class="admin-count">共 {{ filteredItems.length }} / {{ items.length }} 个</span>
        <button @click="openCreate" class="btn btn-primary admin-action">+ 新建客户端</button>
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
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 w-10">
                <input type="checkbox" class="bulk-cb"
                       :checked="pageAllChecked" :indeterminate.prop="pageSomeChecked"
                       @change="togglePage($event.target.checked)" />
              </th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">名称</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">Client ID</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">最低等级</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">状态</th>
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
              <td class="px-4 py-3 font-semibold text-fg">{{ c.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-fg-dim">{{ c.clientId }}</td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ levelLabel(c.minLevel) }}</td>
              <td class="px-4 py-3"><span :class="c.status === 'active' ? 'badge-emerald' : 'badge-slate'">{{ statusLabel(c.status) }}</span></td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(c)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onRotate(c)" class="btn btn-ghost btn-sm">轮换密钥</button>
                <button @click="onDelete(c)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
            <tr v-if="filteredItems.length === 0">
              <td colspan="6" class="px-4 py-12 text-center text-fg-dim text-sm">
                {{ items.length === 0 ? '暂无客户端' : '没有匹配的客户端' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filteredItems.length > 0" class="px-4 py-2">
        <Pagination :total="filteredItems.length" v-model:current-page="page" :page-size="10" />
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑客户端' : '新建客户端'">
      <div v-if="editing" class="space-y-4">
        <div><label class="label">应用名称</label><input v-model="editing.name" class="input" /></div>
        <div v-if="!editing.id">
          <label class="label">Client ID (字母数字短横线)</label>
          <input v-model="editing.clientId" class="input input-mono" />
        </div>
        <div><label class="label">描述 <span class="label-opt">(可选)</span></label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">主页 URL <span class="label-opt">(可选)</span></label><input v-model="editing.homepageUrl" class="input input-mono" placeholder="https://app.example.com" /></div>
          <div><label class="label">Logo URL <span class="label-opt">(可选)</span></label><input v-model="editing.logoUrl" class="input input-mono" placeholder="https://app.example.com/logo.svg" /></div>
        </div>
        <div>
          <label class="label">回调 URI (每行一个)</label>
          <textarea v-model="redirectURIsText" rows="3" class="input input-mono" placeholder="https://app.example.com/callback"></textarea>
        </div>
        <div>
          <label class="label">允许的 Scopes</label>
          <div class="scope-grid">
            <label v-for="s in availableScopes" :key="s.value" class="scope-item" :class="{ 'scope-item-on': isScopeOn(s.value) }">
              <input
                type="checkbox"
                :checked="isScopeOn(s.value)"
                @change="toggleScope(s.value, $event.target.checked)"
              />
              <div class="scope-meta">
                <span class="scope-name">{{ s.value }}</span>
                <span class="scope-desc">{{ s.description }}</span>
              </div>
            </label>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">最低用户等级</label>
            <select v-model.number="editing.minLevel" class="input">
              <option :value="0">普通用户</option>
              <option :value="1">成员</option>
              <option :value="2">管理员</option>
            </select>
          </div>
          <div v-if="editing.id">
            <label class="label">状态</label>
            <select v-model="editing.status" class="input">
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="modalOpen = false" class="btn btn-secondary">取消</button>
        <button @click="onSave" :disabled="busy" class="btn btn-primary">{{ busy ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>

    <Modal v-model="secretOpen" title="客户端密钥 (仅展示一次)">
      <div class="space-y-4">
        <div class="alert-warn">
          请立即复制并妥善保管。关闭后无法再次查看。
        </div>
        <div>
          <label class="label">Client ID</label>
          <input :value="secretInfo.clientId" readonly class="input input-mono" />
        </div>
        <div>
          <label class="label">Client Secret</label>
          <input :value="secretInfo.clientSecret" readonly class="input input-mono" />
        </div>
      </div>
      <template #footer>
        <button @click="copySecret" class="btn btn-secondary">复制密钥</button>
        <button @click="secretOpen = false" class="btn btn-primary">已保存,关闭</button>
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
const secretOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const secretInfo = ref({});
const page = ref(1);
const search = ref("");
const statusFilter = ref("");
const selected = ref({});
const bulkBusy = ref(false);
const PAGE_SIZE = 10;

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  const st = statusFilter.value;
  return items.value.filter(c => {
    if (st && c.status !== st) return false;
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.clientId || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q)
    );
  });
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredItems.value.slice(start, start + PAGE_SIZE);
});

watch([search, statusFilter], () => { page.value = 1; });

function clearSelection() { selected.value = {}; }
const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);
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

const availableScopes = [
  { value: "openid",         description: "OpenID Connect 必要 scope,标识用户身份" },
  { value: "profile",        description: "用户基础资料(姓名、头像、简介)" },
  { value: "email",          description: "用户邮箱地址" },
  { value: "offline_access", description: "允许签发 refresh_token,无需用户在场即可续期" },
];

function isScopeOn(value) {
  return Array.isArray(editing.value?.scopes) && editing.value.scopes.includes(value);
}
function toggleScope(value, on) {
  if (!editing.value) return;
  const cur = Array.isArray(editing.value.scopes) ? editing.value.scopes : [];
  if (on) {
    if (!cur.includes(value)) editing.value.scopes = [...cur, value];
  } else {
    editing.value.scopes = cur.filter((x) => x !== value);
  }
}

const redirectURIsText = computed({
  get: () => (editing.value?.redirectUris || []).join("\n"),
  set: (v) => { editing.value.redirectUris = v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); },
});

const levelLabel = (n) => ({0:"用户", 1:"成员", 2:"管理员"})[n] || n;
const statusLabel = (s) => ({active:"启用", disabled:"停用"})[s] || s;

async function load() {
  try {
    const r = await api.get("/admin/oauth-clients");
    items.value = r.items || [];
    const ids = new Set(items.value.map(x => x.id));
    for (const k of Object.keys(selected.value)) {
      if (!ids.has(k)) delete selected.value[k];
    }
  } catch (e) { errToast(e.message); }
}

function openCreate() {
  editing.value = { name: "", clientId: "", description: "", homepageUrl: "", logoUrl: "",
                    minLevel: 0, redirectUris: [], scopes: ["openid","profile","email"], status: "active" };
  modalOpen.value = true;
}
function openEdit(c) { editing.value = { ...c, scopes: [...(c.scopes || [])] }; modalOpen.value = true; }

async function onSave() {
  busy.value = true;
  try {
    const body = { ...editing.value };
    let res;
    if (editing.value.id) {
      await api.patch("/admin/oauth-clients/" + editing.value.id, body);
      okToast("客户端已更新");
    } else {
      res = await api.post("/admin/oauth-clients", body);
    }
    modalOpen.value = false;
    await load();
    if (res?.clientSecret) {
      secretInfo.value = res;
      secretOpen.value = true;
    }
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function onRotate(c) {
  const ok = await useConfirm({
    title: "轮换密钥",
    message: `轮换 "${c.name}" 的客户端密钥?`,
    detail: "旧密钥将立即失效,所有使用旧密钥的应用都需要更新配置。",
    kind: "danger",
    confirmText: "确认轮换",
  });
  if (!ok) return;
  try {
    const res = await api.post("/admin/oauth-clients/" + c.id + "/rotate-secret");
    secretInfo.value = res;
    secretOpen.value = true;
    okToast("密钥已轮换");
  } catch (e) { errToast(e.message); }
}

async function onDelete(c) {
  const ok = await useConfirm({
    title: "删除客户端",
    message: `确认删除 "${c.name}"?`,
    detail: "将连同所有 access token、refresh token 与用户授权一并清除。",
    kind: "danger",
    confirmText: "永久删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/oauth-clients/" + c.id);
    okToast("客户端已删除");
    delete selected.value[c.id];
    await load();
  } catch (e) { errToast(e.message); }
}

async function onBulkDelete() {
  if (bulkBusy.value) return;
  const ids = Object.keys(selected.value).filter(id => selected.value[id]);
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const targets = items.value.filter(c => idSet.has(c.id));
  const sample = targets.slice(0, 5).map(c => "· " + c.name).join("\n");
  const more = targets.length > 5 ? `\n…还有 ${targets.length - 5} 个` : "";
  const ok = await useConfirm({
    title: "批量删除客户端",
    message: `确认删除选中的 ${ids.length} 个 OAuth 客户端?`,
    detail: "将连同所有 access token、refresh token 与用户授权一并清除,不可恢复。\n\n" + sample + more,
    kind: "danger",
    confirmText: `永久删除 ${ids.length} 个`,
  });
  if (!ok) return;

  bulkBusy.value = true;
  let okCount = 0, failCount = 0;
  for (const id of ids) {
    try {
      await api.delete("/admin/oauth-clients/" + id);
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

function copySecret() {
  navigator.clipboard?.writeText(secretInfo.value.clientSecret || "")
    .then(() => okToast("Client Secret 已复制到剪贴板"))
    .catch(() => errToast("复制失败,请手动选择文本"));
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
.alert-warn {
  font-size: 13px;
  border-radius: 12px;
  border: 1px solid rgba(217, 119, 6, 0.40);
  background-color: rgba(254, 243, 199, 0.6);
  padding: 12px 14px;
  color: #92400E;
  font-weight: 500;
}
.label-opt {
  color: var(--fg-mute);
  font-weight: normal;
  font-size: 11px;
  letter-spacing: normal;
  margin-left: 4px;
  text-transform: none;
}
.scope-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.scope-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 36, 25, 0.14);
  background-color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  transition: all 0.14s ease;
}
.scope-item:hover {
  border-color: rgba(15, 36, 25, 0.24);
  background-color: white;
}
.scope-item-on {
  border-color: rgba(16, 185, 129, 0.55);
  background-color: rgba(167, 243, 208, 0.30);
}
.scope-item input[type="checkbox"] {
  margin-top: 2px;
  flex-shrink: 0;
  accent-color: var(--brand);
}
.scope-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.scope-name {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg);
}
.scope-desc {
  font-size: 11px;
  color: var(--fg-mute);
  line-height: 1.4;
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
