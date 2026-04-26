<template>
  <div class="space-y-5">
    <header class="admin-tab-head">
      <h1 class="h-page">用户<span class="text-teal-300">.</span></h1>
      <button @click="openCreate" class="btn btn-primary">+ 新建用户</button>
    </header>

    <div class="admin-toolbar">
      <input v-model="search" placeholder="搜索邮箱 / 姓名…" class="input admin-search" />
      <span class="admin-count">共 {{ filteredUsers.length }} / {{ total }} 个 (当前页)</span>
    </div>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="admin-thead">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">邮箱</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">姓名</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">角色</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">状态</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-semibold uppercase tracking-wider">最后登录</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in filteredUsers" :key="u.id" class="admin-row">
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
              <td colspan="6" class="px-4 py-12 text-center text-fg-dim text-sm">
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

// 用户列表是服务端分页(每页 10),搜索只在当前页内做。如果未来要全库搜索,
// 可以加 q 参数到 /admin/users。这里先满足管理员"找个名字"的轻量需求。
const filteredUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter(u =>
    (u.email || "").toLowerCase().includes(q) ||
    (u.name || "").toLowerCase().includes(q));
});

async function load() {
  try {
    const r = await api.get(`/admin/users?limit=10&offset=${(page.value - 1) * 10}`);
    users.value = r.items || [];
    total.value = r.total || 0;
  } catch (e) { errToast(e.message); }
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
    await load();
  } catch (e) { errToast(e.message); }
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
</style>
