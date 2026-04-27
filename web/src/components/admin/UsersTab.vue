<template>
  <div class="space-y-5">
    <!-- 标题已经由侧边栏给出。"+ 新建用户" 并入 toolbar 末尾。 -->
    <div class="admin-sticky-head">
      <!-- 工具栏:搜索 + 角色 + 状态 + 计数 + 新建。
           用户列表是服务端分页的,所以 role / status 这两个 filter 走服务端
           (后端 /admin/users 已经接受 ?role= 和 ?status= 参数,正好对接);
           搜索仍在当前页内做,与原版一致 — 想全库搜索得后端加 q,本次不动。 -->
      <div class="admin-toolbar">
        <input v-model="search" placeholder="搜索邮箱 / 姓名…(当前页)" class="input admin-search" />
        <select v-model="roleFilter" class="input admin-filter" @change="resetAndLoad">
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="member">成员</option>
          <option value="user">普通用户</option>
        </select>
        <select v-model="statusFilter" class="input admin-filter" @change="resetAndLoad">
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="banned">封禁</option>
          <option value="disabled">禁用</option>
        </select>
        <span class="admin-count">共 {{ filteredUsers.length }} / {{ total }} 个 (当前页)</span>
        <button @click="openCreate" class="btn btn-primary admin-action">+ 新建用户</button>
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
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">邮箱</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">姓名</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">角色</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">状态</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">最后登录</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in filteredUsers" :key="u.id"
                :class="['admin-row', selected[u.id] && 'admin-row-selected', !canDelete(u) && 'admin-row-locked']">
              <td class="px-4 py-3">
                <input type="checkbox" class="bulk-cb"
                       :checked="!!selected[u.id]"
                       :disabled="!canDelete(u)"
                       :title="!canDelete(u) ? '不能删除自己 / 最后一个管理员' : ''"
                       @change="toggleOne(u.id, $event.target.checked)" />
              </td>
              <td class="px-4 py-3 font-mono text-xs text-fg">{{ u.email }}</td>
              <td class="px-4 py-3 text-fg">{{ u.name }}</td>
              <td class="px-4 py-3"><span :class="roleBadge(u.role)">{{ roleLabel(u.role) }}</span></td>
              <td class="px-4 py-3"><span :class="statusBadge(u.status)">{{ statusLabel(u.status) }}</span></td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ formatTime(u.lastLoginAt) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(u)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onDelete(u)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
            <tr v-if="filteredUsers.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-fg-dim text-sm">
                {{ users.length === 0 ? '暂无用户' : '没有匹配当前搜索' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="total > 0" class="px-4 py-2">
        <Pagination :total="total" v-model:current-page="page" :page-size="10" @page-change="load" />
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑用户' : '新建用户'">
      <div v-if="editing" class="space-y-4">
        <div>
          <label class="label">邮箱</label>
          <input v-model="editing.email" :disabled="!!editing.id" type="email" class="input" />
        </div>
        <div>
          <label class="label">姓名</label>
          <input v-model="editing.name" class="input" />
        </div>
        <div v-if="!editing.id">
          <label class="label">密码</label>
          <PasswordInput v-model="editing.password" autocomplete="new-password" placeholder="至少 8 字符" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">角色</label>
            <select v-model="editing.role" class="input">
              <option value="user">普通用户</option>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div v-if="editing.id">
            <label class="label">状态</label>
            <select v-model="editing.status" class="input">
              <option value="active">活跃</option>
              <option value="banned">封禁</option>
              <option value="disabled">禁用</option>
            </select>
          </div>
        </div>
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
import { formatTime } from "../../format.js";
import { currentUser } from "../../session.js";
import Modal from "../Modal.vue";
import Pagination from "../Pagination.vue";
import PasswordInput from "../PasswordInput.vue";

const users = ref([]);
const total = ref(0);
const modalOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const page = ref(1);
const search = ref("");
const roleFilter = ref("");
const statusFilter = ref("");
const selected = ref({});
const bulkBusy = ref(false);

const roleLabel = (r) => ({admin:"管理员", member:"成员", user:"用户"}[r] || r);
const statusLabel = (s) => ({active:"活跃", banned:"封禁", disabled:"禁用"}[s] || s);

function roleBadge(r) {
  if (r === "admin") return "badge-amber";
  if (r === "member") return "badge-emerald";
  return "badge-slate";
}
function statusBadge(s) {
  if (s === "active") return "badge-emerald";
  if (s === "banned") return "badge-red";
  return "badge-slate";
}

// canDelete:本地预先排除"自己"。后端还有"最后一个管理员"的二次校验,
// 我们只能告诉用户"自己"不能删 — 因为没有总管理员数。前端不需要也不应
// 该再实现一遍服务端逻辑,失败时把后端的错误信息透出就够了。
function canDelete(u) {
  return !currentUser.value || currentUser.value.id !== u.id;
}

const filteredUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter(u =>
    (u.email || "").toLowerCase().includes(q) ||
    (u.name || "").toLowerCase().includes(q));
});

function clearSelection() { selected.value = {}; }
const selectedCount = computed(() => Object.values(selected.value).filter(Boolean).length);

// 选中状态只看 *本页可选* 的用户 — 已禁用 checkbox 的不算
const selectableOnPage = computed(() => filteredUsers.value.filter(canDelete));
const pageAllChecked = computed(() =>
  selectableOnPage.value.length > 0 && selectableOnPage.value.every(u => selected.value[u.id])
);
const pageSomeChecked = computed(() => {
  const some = selectableOnPage.value.some(u => selected.value[u.id]);
  return some && !pageAllChecked.value;
});

function toggleOne(id, on) {
  if (on) selected.value[id] = true;
  else delete selected.value[id];
}
function togglePage(on) {
  for (const u of selectableOnPage.value) {
    if (on) selected.value[u.id] = true;
    else delete selected.value[u.id];
  }
}

async function load() {
  try {
    const params = new URLSearchParams();
    params.set("limit", "10");
    params.set("offset", String((page.value - 1) * 10));
    if (roleFilter.value) params.set("role", roleFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    const r = await api.get(`/admin/users?${params.toString()}`);
    users.value = r.items || [];
    total.value = r.total || 0;
  } catch (e) { errToast(e.message); }
}

// filter 变化时回到第 1 页 — 否则可能停在不存在的页码上
function resetAndLoad() {
  page.value = 1;
  load();
}

function openCreate() {
  editing.value = { email: "", name: "", password: "", role: "user" };
  modalOpen.value = true;
}
function openEdit(u) {
  editing.value = { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, bio: u.bio };
  modalOpen.value = true;
}

async function onSave() {
  busy.value = true;
  try {
    if (editing.value.id) {
      await api.patch("/admin/users/" + editing.value.id, {
        name: editing.value.name, role: editing.value.role,
        status: editing.value.status, bio: editing.value.bio,
      });
      okToast("用户已更新");
    } else {
      await api.post("/admin/users", {
        email: editing.value.email, password: editing.value.password,
        name: editing.value.name, role: editing.value.role,
      });
      okToast("用户已创建");
    }
    modalOpen.value = false;
    await load();
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function onDelete(u) {
  const ok = await useConfirm({
    title: "删除用户",
    message: `确认删除用户 "${u.name || u.email}"?`,
    detail: `这将连同其所有 OAuth token、授权与活动日志一并清除,操作不可恢复。\n邮箱:${u.email}`,
    kind: "danger",
    confirmText: "永久删除",
  });
  if (!ok) return;
  try {
    await api.delete("/admin/users/" + u.id);
    okToast("用户已删除");
    delete selected.value[u.id];
    await load();
  } catch (e) { errToast(e.message); }
}

// 批量删除:逐条调用,后端的"不能删自己 / 不能删最后管理员"校验全部保留。
// 失败时把错误信息聚合上报,不打断其它项的删除。
async function onBulkDelete() {
  if (bulkBusy.value) return;
  const ids = Object.keys(selected.value).filter(id => selected.value[id]);
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const targets = users.value.filter(u => idSet.has(u.id));
  const sample = targets.slice(0, 5).map(u => "· " + (u.name || u.email)).join("\n");
  const more = targets.length > 5 ? `\n…还有 ${targets.length - 5} 个` : "";
  const ok = await useConfirm({
    title: "批量删除用户",
    message: `确认删除选中的 ${ids.length} 个用户?`,
    detail: "将连同其所有 OAuth token、授权与活动日志一并清除,不可恢复。\n\n" + sample + more,
    kind: "danger",
    confirmText: `永久删除 ${ids.length} 个`,
  });
  if (!ok) return;

  bulkBusy.value = true;
  let okCount = 0;
  const failures = [];   // 收集所有失败原因,展示给管理员
  for (const id of ids) {
    try {
      await api.delete("/admin/users/" + id);
      delete selected.value[id];
      okCount++;
    } catch (e) {
      const u = users.value.find(x => x.id === id);
      failures.push((u?.email || id) + ": " + (e.message || "失败"));
    }
  }
  bulkBusy.value = false;
  if (failures.length === 0) {
    okToast(`已删除 ${okCount} 个`);
  } else {
    // 失败可能是"最后管理员"等正当拦截,详细信息比纯计数有用得多
    errToast(`成功 ${okCount} / 失败 ${failures.length} — ${failures[0]}${failures.length > 1 ? ` (还有 ${failures.length - 1} 项)` : ''}`);
  }
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
  max-width: 320px;
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
.admin-row-locked .bulk-cb {
  opacity: 0.35;
  cursor: not-allowed;
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
