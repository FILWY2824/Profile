<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="h-page">OAuth 客户端</h1>
        <p class="text-fg-dim text-sm mt-1.5">{{ items.length }} 个已注册客户端</p>
      </div>
      <button @click="openCreate" class="btn btn-primary">+ 新建客户端</button>
    </header>

    <div class="surface overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line bg-bg-2/50">
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">名称</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">Client ID</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">最低等级</th>
              <th class="px-4 py-3 text-left text-xs text-fg-mute font-medium uppercase tracking-wider">状态</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id" class="border-b border-line/60 hover:bg-white/3 transition-colors">
              <td class="px-4 py-3 font-medium text-fg">{{ c.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-fg-dim">{{ c.clientId }}</td>
              <td class="px-4 py-3 text-xs text-fg-dim">{{ levelLabel(c.minLevel) }}</td>
              <td class="px-4 py-3"><span :class="c.status === 'active' ? 'badge-emerald' : 'badge-slate'">{{ statusLabel(c.status) }}</span></td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button @click="openEdit(c)" class="btn btn-ghost btn-sm">编辑</button>
                <button @click="onRotate(c)" class="btn btn-ghost btn-sm">轮换密钥</button>
                <button @click="onDelete(c)" class="btn btn-ghost btn-sm text-danger hover:!text-danger">删除</button>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="5" class="px-4 py-12 text-center text-fg-dim text-sm">暂无客户端</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model="modalOpen" :title="editing?.id ? '编辑客户端' : '新建客户端'">
      <div v-if="editing" class="space-y-4">
        <div><label class="label">应用名称</label><input v-model="editing.name" class="input" /></div>
        <div v-if="!editing.id">
          <label class="label">Client ID (字母数字短横线)</label>
          <input v-model="editing.clientId" class="input input-mono" />
        </div>
        <div><label class="label">描述</label><textarea v-model="editing.description" rows="2" class="input"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">主页 URL</label><input v-model="editing.homepageUrl" class="input input-mono" /></div>
          <div><label class="label">Logo URL</label><input v-model="editing.logoUrl" class="input input-mono" /></div>
        </div>
        <div>
          <label class="label">回调 URI (每行一个)</label>
          <textarea v-model="redirectURIsText" rows="3" class="input input-mono" placeholder="https://app.example.com/callback"></textarea>
        </div>
        <div>
          <label class="label">允许的 Scopes (空格分隔)</label>
          <input v-model="scopesText" class="input input-mono" placeholder="openid profile email" />
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
        <div class="text-sm rounded-lg border border-warn/40 bg-warn/10 p-3 text-warn">
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
import { ref, computed, onMounted } from "vue";
import { api } from "../../api.js";
import { okToast, errToast } from "../../toast.js";
import Modal from "../Modal.vue";

const items = ref([]);
const modalOpen = ref(false);
const secretOpen = ref(false);
const editing = ref(null);
const busy = ref(false);
const secretInfo = ref({});

const redirectURIsText = computed({
  get: () => (editing.value?.redirectUris || []).join("\n"),
  set: (v) => { editing.value.redirectUris = v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); },
});
const scopesText = computed({
  get: () => (editing.value?.scopes || []).join(" "),
  set: (v) => { editing.value.scopes = v.split(/\s+/).filter(Boolean); },
});

const levelLabel = (n) => ({0:"用户", 1:"成员", 2:"管理员"})[n] || n;
const statusLabel = (s) => ({active:"启用", disabled:"停用"})[s] || s;

async function load() { const r = await api.get("/admin/oauth-clients"); items.value = r.items || []; }

function openCreate() {
  editing.value = { name: "", clientId: "", description: "", homepageUrl: "", logoUrl: "",
                    minLevel: 0, redirectUris: [], scopes: ["openid","profile"], status: "active" };
  modalOpen.value = true;
}
function openEdit(c) { editing.value = { ...c }; modalOpen.value = true; }

async function onSave() {
  busy.value = true;
  try {
    const body = { ...editing.value };
    let res;
    if (editing.value.id) {
      await api.patch("/admin/oauth-clients/" + editing.value.id, body);
    } else {
      res = await api.post("/admin/oauth-clients", body);
    }
    modalOpen.value = false;
    await load();
    if (res?.clientSecret) {
      secretInfo.value = res;
      secretOpen.value = true;
    } else {
      okToast("已保存");
    }
  } catch (e) { errToast(e.message); } finally { busy.value = false; }
}

async function onRotate(c) {
  if (!confirm(`轮换 ${c.name} 的密钥? 旧密钥将立即失效。`)) return;
  try {
    const res = await api.post("/admin/oauth-clients/" + c.id + "/rotate-secret");
    secretInfo.value = res;
    secretOpen.value = true;
  } catch (e) { errToast(e.message); }
}

async function onDelete(c) {
  if (!confirm(`删除 ${c.name}? 将连同所有 token / 授权一并清除。`)) return;
  try { await api.delete("/admin/oauth-clients/" + c.id); okToast("已删除"); await load(); }
  catch (e) { errToast(e.message); }
}

function copySecret() {
  navigator.clipboard?.writeText(secretInfo.value.clientSecret || "").then(() => okToast("已复制"));
}

onMounted(load);
</script>
