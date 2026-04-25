<template>
  <div>
    <!-- 档案号 / Hero -->
    <header class="mb-12 sm:mb-16">
      <div class="flex items-baseline justify-between gap-4 mb-3">
        <span class="archive-no">VOL. I · ARCHIVE № 001</span>
        <span class="archive-no hidden sm:inline">{{ today }}</span>
      </div>

      <div class="rule-double mb-6"></div>

      <h1 class="h-page mb-4">
        {{ siteName }}<span class="text-cinnabar">.</span>
      </h1>

      <p v-if="siteDescription" class="text-lg text-ash max-w-2xl leading-relaxed font-serif" style="font-variation-settings:'opsz' 36, 'SOFT' 50;">
        {{ siteDescription }}
      </p>
      <p v-else class="text-lg text-ash max-w-2xl leading-relaxed font-serif" style="font-variation-settings:'opsz' 36, 'SOFT' 50;">
        一处栖息思考、串联万物的私人档案室。
      </p>
    </header>

    <!-- 加载/空态 -->
    <div v-if="loading" class="py-20 text-center">
      <div class="archive-no">LOADING · 正在调取档案</div>
    </div>

    <div v-else-if="!sections.length && !orphanCards.length" class="surface p-12 text-center">
      <div class="seal seal-lg mx-auto mb-4 opacity-30">栖</div>
      <p class="h-sub mb-2">档案室空空如也</p>
      <p class="text-sm text-ash">
        管理员可在
        <a href="#/admin" class="underline decoration-cinnabar/40 hover:decoration-cinnabar">后台</a>
        创建板块与卡片
      </p>
    </div>

    <!-- 板块列表 -->
    <div v-else class="space-y-16">
      <section v-for="(sec, idx) in sections" :key="sec.id" class="animate-fade-up" :style="{ animationDelay: `${idx * 60}ms` }">
        <header class="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div class="flex items-baseline gap-4 flex-1 min-w-0">
            <span class="archive-no-strong tabular-nums">{{ pad(idx + 1) }}.</span>
            <h2 class="h-section truncate">{{ sec.name }}</h2>
          </div>
          <p v-if="sec.description" class="text-sm text-ash italic max-w-md text-right">
            {{ sec.description }}
          </p>
        </header>
        <div class="rule-h mb-6"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardTile v-for="c in cardsBySection(sec.id)" :key="c.id" :card="c" />
        </div>
      </section>

      <section v-if="orphanCards.length" class="animate-fade-up" :style="{ animationDelay: `${sections.length * 60}ms` }">
        <header class="mb-5 flex items-baseline gap-4">
          <span class="archive-no-strong tabular-nums">{{ pad(sections.length + 1) }}.</span>
          <h2 class="h-section">未分卷宗</h2>
        </header>
        <div class="rule-h mb-6"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardTile v-for="c in orphanCards" :key="c.id" :card="c" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api.js";
import CardTile from "../components/CardTile.vue";

const sections = ref([]);
const cards = ref([]);
const siteName = ref("栖枢");
const siteDescription = ref("");
const loading = ref(true);

function cardsBySection(id) {
  return cards.value.filter((c) => c.sectionId === id).sort((a, b) => a.order - b.order);
}

const orphanCards = computed(() =>
  cards.value.filter((c) => !c.sectionId).sort((a, b) => a.order - b.order),
);

const today = computed(() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
});

function pad(n) { return String(n).padStart(2, "0"); }

onMounted(async () => {
  try {
    const data = await api.get("/homepage");
    sections.value = (data.sections || []).sort((a, b) => a.order - b.order);
    cards.value = data.cards || [];
    siteName.value = data.siteName || "栖枢";
    siteDescription.value = data.siteDescription || "";
    document.title = siteName.value + " · Qishu Archive";
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});
</script>
