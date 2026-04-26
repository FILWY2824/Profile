<template>
  <div class="space-y-8">
    <header>
      <h1 class="h-page">总览<span class="text-teal-300">.</span></h1>
      <p class="text-fg-dim text-[15px] mt-2">站点统计与运行状况</p>
    </header>

    <div v-if="loading" class="surface p-12 text-center text-fg-dim text-sm">
      <span class="inline-block h-2 w-2 rounded-full bg-teal-500 animate-shine mr-2 align-middle"></span>
      加载中
    </div>

    <template v-else>
      <!-- 统计卡片 -->
      <section>
        <h2 class="h-section mb-4">站点统计<span class="ic-accent">✦</span></h2>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div v-for="s in stats" :key="s.label" class="surface p-5 relative overflow-hidden">
            <div class="flex items-start justify-between mb-3">
              <span class="text-2xl">{{ s.icon }}</span>
              <span class="text-[10px] text-fg-mute font-mono uppercase tracking-wider">{{ s.eyebrow }}</span>
            </div>
            <div class="font-display font-bold leading-none tracking-tight stat-num" :class="s.color || 'text-fg'">
              {{ s.value }}
            </div>
            <div class="text-sm text-fg mt-2 font-medium">{{ s.label }}</div>
            <div v-if="s.detail" class="text-xs text-fg-mute mt-1">{{ s.detail }}</div>
          </div>
        </div>
      </section>

      <!-- 运行时内存 -->
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="h-section">运行时<span class="ic-accent">⌬</span></h2>
          <button @click="loadRuntime(true)" class="btn btn-ghost btn-sm">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            刷新
          </button>
        </div>

        <div v-if="runtimeErr" class="surface p-6 text-danger text-sm">
          运行时数据读取失败: {{ runtimeErr }}
        </div>

        <div v-else-if="!rt" class="surface p-6 text-fg-dim text-sm text-center">读取中…</div>

        <div v-else class="space-y-4">
          <!-- cgroup 内存条 -->
          <div class="surface p-6">
            <div class="flex items-baseline justify-between mb-3">
              <div class="text-sm font-semibold text-fg">容器内存</div>
              <div class="font-mono text-xs">
                <span :class="memOver ? 'text-danger' : 'text-ok'">{{ usagePct }}%</span>
                <span class="text-fg-mute"> of limit</span>
              </div>
            </div>
            <div class="flex items-baseline gap-3 mb-4">
              <span class="font-display font-bold tabular-nums tracking-tight stat-num-lg"
                    :class="memOver ? 'text-danger' : 'text-fg'">
                {{ formatMiB(rt.cgroupMemoryCurrentBytes) }}
              </span>
              <span class="font-mono text-sm text-fg-dim">/ {{ rt.cgroupMemoryMaxBytes > 0 ? formatMiB(rt.cgroupMemoryMaxBytes) : '∞' }} MiB</span>
            </div>
            <!-- 进度条 -->
            <div class="progress-track">
              <div class="progress-bar"
                   :class="memOver ? 'progress-bar-danger' : (usageNum > 75 ? 'progress-bar-warn' : 'progress-bar-ok')"
                   :style="{ width: Math.min(100, usageNum) + '%' }"></div>
            </div>
            <p class="text-xs text-fg-dim mt-3 leading-relaxed">
              <span class="text-teal-300">·</span>
              这是容器 cgroup 的实际 RSS。目标稳态 &lt; 50 MiB,容器 limit 100 MiB 留 2x 余量。
            </p>
          </div>

          <!-- Go runtime 细分 -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="surface p-4">
              <div class="text-xs text-fg-mute uppercase tracking-wider mb-2 font-semibold">Heap Alloc</div>
              <div class="font-display font-bold text-2xl tabular-nums">{{ formatKiB(rt.heapAllocKiB) }}</div>
              <div class="text-xs text-fg-mute mt-1">活跃堆对象</div>
            </div>
            <div class="surface p-4">
              <div class="text-xs text-fg-mute uppercase tracking-wider mb-2 font-semibold">Heap Sys</div>
              <div class="font-display font-bold text-2xl tabular-nums">{{ formatKiB(rt.heapSysKiB) }}</div>
              <div class="text-xs text-fg-mute mt-1">runtime 持有</div>
            </div>
            <div class="surface p-4">
              <div class="text-xs text-fg-mute uppercase tracking-wider mb-2 font-semibold">Released</div>
              <div class="font-display font-bold text-2xl tabular-nums text-ok">{{ formatKiB(rt.heapReleasedKiB) }}</div>
              <div class="text-xs text-fg-mute mt-1">已还给内核</div>
            </div>
            <div class="surface p-4">
              <div class="text-xs text-fg-mute uppercase tracking-wider mb-2 font-semibold">Goroutines</div>
              <div class="font-display font-bold text-2xl tabular-nums">{{ rt.goroutines }}</div>
              <div class="text-xs text-fg-mute mt-1">{{ rt.threads > 0 ? rt.threads + ' OS 线程' : '' }}</div>
            </div>
          </div>

          <!-- GC 摘要 -->
          <div class="surface p-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs">
            <div class="flex items-baseline gap-2">
              <span class="text-fg-mute">GC RUNS</span>
              <span class="text-fg tabular-nums font-semibold">{{ rt.numGC }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-fg-mute">FORCED</span>
              <span class="text-fg tabular-nums font-semibold">{{ rt.numForcedGC }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-fg-mute">GC CPU</span>
              <span class="text-fg tabular-nums font-semibold">{{ (rt.gcCpuFraction * 100).toFixed(2) }}%</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-fg-mute">GOMAXPROCS</span>
              <span class="text-fg tabular-nums font-semibold">{{ rt.gomaxprocs }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-fg-mute">STACK</span>
              <span class="text-fg tabular-nums font-semibold">{{ formatKiB(rt.stackInuseKiB) }}</span>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../../api.js";

const data = ref({});
const loading = ref(true);

const rt = ref(null);
const runtimeErr = ref("");

let pollTimer = null;

onMounted(async () => {
  try { data.value = await api.get("/admin/dashboard"); }
  finally { loading.value = false; }
  loadRuntime();
  pollTimer = setInterval(loadRuntime, 30000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function loadRuntime() {
  try {
    rt.value = await api.get("/admin/runtime");
    runtimeErr.value = "";
  } catch (e) {
    runtimeErr.value = e.message;
  }
}

const stats = computed(() => {
  const d = data.value || {};
  const r = d.users?.byRole || {};
  return [
    {
      icon: "👥",
      eyebrow: "USERS",
      label: "用户总数",
      value: d.users?.total || 0,
      detail: `管理员 ${r.admin || 0} · 成员 ${r.member || 0} · 用户 ${r.user || 0}`,
    },
    {
      icon: "📂",
      eyebrow: "SECTIONS",
      label: "板块",
      value: d.sections || 0,
      detail: "分组数",
    },
    {
      icon: "🔗",
      eyebrow: "CARDS",
      label: "卡片",
      value: d.cards || 0,
      detail: "工具条目",
    },
    {
      icon: "✓",
      eyebrow: "STATUS",
      label: "运行中",
      value: "OK",
      detail: "服务健康",
      color: "text-ok",
    },
  ];
});

function formatMiB(bytes) {
  if (!bytes || bytes < 0) return "—";
  return (bytes / 1024 / 1024).toFixed(1);
}
function formatKiB(kib) {
  if (kib === undefined || kib === null) return "—";
  if (kib >= 1024) return (kib / 1024).toFixed(1) + " MiB";
  return kib + " KiB";
}
const usageNum = computed(() => {
  if (!rt.value || rt.value.cgroupMemoryCurrentBytes < 0 || rt.value.cgroupMemoryMaxBytes <= 0) return 0;
  return (rt.value.cgroupMemoryCurrentBytes / rt.value.cgroupMemoryMaxBytes) * 100;
});
const usagePct = computed(() => usageNum.value.toFixed(1));
const memOver = computed(() => usageNum.value > 90);
</script>

<style scoped>
.ic-accent {
  font-style: italic;
  font-weight: 500;
  margin-left: 6px;
  color: var(--brand);
}
.stat-num {
  font-size: clamp(1.875rem, 3.5vw, 2.5rem);
}
.stat-num-lg {
  font-size: clamp(2rem, 4.5vw, 2.75rem);
}
.progress-track {
  height: 6px;
  background-color: rgba(15, 36, 25, 0.06);
  border-radius: 999px;
  position: relative;
  overflow: hidden;
}
.progress-bar {
  position: absolute;
  inset-block: 0;
  left: 0;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.progress-bar-ok {
  background: linear-gradient(90deg, #34D399, #10B981);
}
.progress-bar-warn {
  background: linear-gradient(90deg, #FBBF24, #D97706);
}
.progress-bar-danger {
  background: linear-gradient(90deg, #F87171, #DC2626);
}
</style>
