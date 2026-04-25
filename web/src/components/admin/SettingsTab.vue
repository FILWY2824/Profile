<template>
  <div class="space-y-6 pb-24">
    <header>
      <h1 class="h-page">系统设置</h1>
      <p class="text-fg-dim text-sm mt-1.5">所有改动只对新会话生效;部分项保存后立即热重载</p>
    </header>

    <div v-if="loading" class="surface p-12 text-center text-fg-dim text-sm">
      <span class="inline-block h-2 w-2 rounded-full bg-teal-300 animate-shine mr-2 align-middle"></span>
      加载中
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-5">
      <!-- Category sidebar -->
      <aside class="lg:sticky lg:top-20 lg:self-start space-y-3">
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

        <div v-if="modifiedKeys.length > 0" class="surface p-3 border-warn/40 bg-warn/5">
          <div class="text-xs text-warn font-medium">{{ modifiedKeys.length }} 项未保存</div>
          <ul class="text-[11px] text-warn/80 font-mono mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
            <li v-for="k in modifiedKeys.slice(0, 8)" :key="k">{{ k }}</li>
            <li v-if="modifiedKeys.length > 8" class="opacity-70">…还有 {{ modifiedKeys.length - 8 }} 项</li>
          </ul>
        </div>
      </aside>

      <!-- Settings list -->
      <div class="space-y-3">
        <div v-if="filteredItems.length === 0" class="surface p-8 text-center text-fg-dim text-sm">
          没有匹配的设置项
        </div>

        <div v-else
             v-for="row in filteredItems" :key="row.key"
             :class="['surface p-4 transition-colors',
                      isModified(row.key) && '!border-warn/40 bg-warn/5']">
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
              <select v-if="row.key === 'TURNSTILE_ENABLED'" v-model="dirty[row.key]" class="input">
                <option value="1">启用</option>
                <option value="0">关闭</option>
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
      <div v-if="modifiedKeys.length > 0"
           class="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 surface-glass shadow-pop px-4 py-3 flex items-center gap-3">
        <div class="text-sm">
          <span class="font-medium text-fg">{{ modifiedKeys.length }}</span>
          <span class="text-fg-dim"> 项未保存</span>
        </div>
        <div class="h-4 w-px bg-line"></div>
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
  "TURNSTILE_ENABLED", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY",
  "RESEND_API_KEY", "RESEND_FROM",
]);
function isHotReload(k) { return hotReloadKeys.has(k); }

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

onMounted(load);
</script>

<style scoped>
.bar-enter-active, .bar-leave-active { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translate(-50%, 20px); }
</style>
