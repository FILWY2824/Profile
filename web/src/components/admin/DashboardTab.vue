<template>
  <div class="space-y-10">
    <header>
      <div class="flex items-baseline justify-between gap-4 mb-3">
        <span class="archive-no">VOL. I · § I · DASHBOARD</span>
        <span class="archive-no">{{ today }}</span>
      </div>
      <div class="rule-double mb-5"></div>
      <h1 class="h-page">总览<span class="text-cinnabar">.</span></h1>
      <p class="text-ash text-base mt-2 font-serif" style="font-variation-settings:'opsz' 24, 'SOFT' 50;">
        站点统计与运行状况速览。
      </p>
    </header>

    <div v-if="loading" class="surface p-12 text-center archive-no">
      LOADING · 加载档案数据
    </div>

    <template v-else>
      <!-- ─── 业务统计 ────────────────────────────────────────── -->
      <section>
        <div class="flex items-baseline gap-3 mb-4">
          <span class="archive-no-strong">01.</span>
          <h2 class="h-section">站点统计</h2>
          <div class="flex-1 rule-h"></div>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div v-for="(s, i) in stats" :key="s.label" class="surface p-6 relative">
            <span class="archive-no-strong absolute top-3 left-4 text-cinnabar tabular-nums">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="archive-no absolute top-3 right-4">{{ s.eyebrow }}</span>
            <div class="mt-8">
              <div class="font-display leading-none tracking-tight" :class="s.color || 'text-ink'"
                  style="font-size: clamp(2.25rem, 4vw, 3rem); font-variation-settings:'opsz' 144, 'SOFT' 50;">
                {{ s.value }}
              </div>
              <div class="rule-h mt-3 mb-2"></div>
              <div class="text-sm text-ink-2 font-medium">{{ s.label }}</div>
              <div v-if="s.detail" class="text-2xs text-ash mt-1">{{ s.detail }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── 运行时内存(可信度核心) ──────────────────────── -->
      <section>
        <div class="flex items-baseline gap-3 mb-4">
          <span class="archive-no-strong">02.</span>
          <h2 class="h-section">运行时内存</h2>
          <div class="flex-1 rule-h"></div>
          <button @click="loadRuntime(true)" class="archive-no hover:text-ink transition-colors">
            ↻ 刷新
          </button>
        </div>

        <div v-if="runtimeErr" class="surface p-6 text-rust text-sm">
          运行时数据读取失败: {{ runtimeErr }}
        </div>

        <div v-else-if="!rt" class="surface p-6 archive-no">读取中…</div>

        <div v-else class="space-y-4">
          <!-- cgroup 内存条 - 直观显示 RSS / limit -->
          <div class="surface p-6">
            <div class="flex items-baseline justify-between mb-3">
              <div class="archive-no">CGROUP MEMORY · 容器实际占用</div>
              <div class="font-mono text-2xs text-ash">
                <span :class="memOver ? 'text-rust' : 'text-sage'">{{ usagePct }}%</span>
                of limit
              </div>
            </div>
            <div class="flex items-baseline gap-3 mb-4">
              <span class="font-display tabular-nums tracking-tight" :class="memOver ? 'text-rust' : 'text-ink'"
                    style="font-size: clamp(2.5rem, 5vw, 3.5rem); font-variation-settings:'opsz' 144, 'SOFT' 50;">
                {{ formatMiB(rt.cgroupMemoryCurrentBytes) }}
              </span>
              <span class="font-mono text-sm text-ash">/ {{ rt.cgroupMemoryMaxBytes > 0 ? formatMiB(rt.cgroupMemoryMaxBytes) : '∞' }} MiB</span>
            </div>
            <!-- 进度条 -->
            <div class="h-1 bg-paper-200 border border-rule-soft relative overflow-hidden">
              <div class="absolute inset-y-0 left-0 transition-all duration-500"
                   :class="memOver ? 'bg-rust' : (usageNum > 75 ? 'bg-ochre' : 'bg-sage')"
                   :style="{ width: Math.min(100, usageNum) + '%' }"></div>
            </div>
            <!-- 百分位标尺 -->
            <div class="flex justify-between mt-1 font-mono text-2xs text-ash-2">
              <span>0</span>
              <span>50</span>
              <span class="text-cinnabar">100 MiB</span>
            </div>
            <p class="archive-no text-2xs mt-4 leading-relaxed normal-case tracking-normal text-ash">
              <span class="text-cinnabar">·</span>
              这是容器 cgroup 计的实际 RSS,docker stats 看到的就是这个。
              目标稳态 &lt; 50 MiB,容器 limit 100 MiB 留 2x 余量。
            </p>
          </div>

          <!-- Go runtime 细分 -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="surface p-5">
              <div class="archive-no mb-2">HEAP ALLOC</div>
              <div class="font-display text-3xl tracking-tight" style="font-variation-settings:'opsz' 96;">
                {{ formatKiB(rt.heapAllocKiB) }}
              </div>
              <div class="text-2xs text-ash mt-1">活跃堆对象</div>
            </div>
            <div class="surface p-5">
              <div class="archive-no mb-2">HEAP SYS</div>
              <div class="font-display text-3xl tracking-tight" style="font-variation-settings:'opsz' 96;">
                {{ formatKiB(rt.heapSysKiB) }}
              </div>
              <div class="text-2xs text-ash mt-1">runtime 持有</div>
            </div>
            <div class="surface p-5">
              <div class="archive-no mb-2">RELEASED</div>
              <div class="font-display text-3xl tracking-tight text-sage" style="font-variation-settings:'opsz' 96;">
                {{ formatKiB(rt.heapReleasedKiB) }}
              </div>
              <div class="text-2xs text-ash mt-1">已还给内核</div>
            </div>
            <div class="surface p-5">
              <div class="archive-no mb-2">GOROUTINES</div>
              <div class="font-display text-3xl tracking-tight tabular-nums" style="font-variation-settings:'opsz' 96;">
                {{ rt.goroutines }}
              </div>
              <div class="text-2xs text-ash mt-1">{{ rt.threads > 0 ? rt.threads + ' OS 线程' : 'OS 线程数未知' }}</div>
            </div>
          </div>

          <!-- GC 摘要(横向小行) -->
          <div class="surface p-4 flex flex-wrap gap-x-8 gap-y-2 font-mono text-2xs">
            <div class="flex items-baseline gap-2">
              <span class="archive-no">GC RUNS</span>
              <span class="text-ink tabular-nums">{{ rt.numGC }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="archive-no">FORCED</span>
              <span class="text-ink tabular-nums">{{ rt.numForcedGC }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="archive-no">GC CPU</span>
              <span class="text-ink tabular-nums">{{ (rt.gcCpuFraction * 100).toFixed(2) }}%</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="archive-no">GOMAXPROCS</span>
              <span class="text-ink tabular-nums">{{ rt.gomaxprocs }}</span>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="archive-no">STACK</span>
              <span class="text-ink tabular-nums">{{ formatKiB(rt.stackInuseKiB) }}</span>
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
  // 每 30 秒自动刷新一次内存数据,与 scavenger 节奏对齐
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

const today = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
});

const stats = computed(() => {
  const d = data.value || {};
  const r = d.users?.byRole || {};
  return [
    {
      eyebrow: "USERS",
      label: "用户总数",
      value: d.users?.total || 0,
      detail: `管理员 ${r.admin || 0} · 成员 ${r.member || 0} · 用户 ${r.user || 0}`,
    },
    {
      eyebrow: "SECTIONS",
      label: "板块",
      value: d.sections || 0,
      detail: "档案分卷数",
    },
    {
      eyebrow: "CARDS",
      label: "卡片",
      value: d.cards || 0,
      detail: "条目记录",
    },
    {
      eyebrow: "STATUS",
      label: "运行中",
      value: "OK",
      detail: "服务健康正常",
      color: "text-sage",
    },
  ];
});

// ─── 内存格式化 ────────────────────────────────────────────────
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
