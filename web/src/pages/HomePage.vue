<template>
  <div>
    <!-- Hero -->
    <header class="mb-10">
      <div class="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700 ring-1 ring-accent-200/70">
        <span class="h-1.5 w-1.5 rounded-full bg-accent-500"></span>
        在线
      </div>
      <h1 class="h-page text-3xl sm:text-4xl">{{ siteName }}</h1>
      <p v-if="siteDescription" class="mt-2 text-tinted">{{ siteDescription }}</p>
    </header>

    <div v-if="loading" class="flex items-center justify-center py-20 text-slate-400 text-sm">
      正在加载…
    </div>

    <div v-else-if="!sections.length" class="surface p-10 text-center text-muted">
      <div class="text-4xl mb-2">📭</div>
      <p>暂无内容</p>
      <p class="text-xs mt-1">管理员可在 <a href="#/admin" class="text-accent-600 hover:underline">后台</a> 创建板块和卡片</p>
    </div>

    <div v-else class="space-y-10">
      <section v-for="sec in sections" :key="sec.id">
        <header class="mb-4 flex items-baseline justify-between">
          <h2 class="h-section">{{ sec.name }}</h2>
          <p v-if="sec.description" class="text-xs text-muted">{{ sec.description }}</p>
        </header>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <CardTile v-for="c in cardsBySection(sec.id)" :key="c.id" :card="c" />
        </div>
      </section>

      <section v-if="orphanCards.length">
        <header class="mb-4">
          <h2 class="h-section text-slate-600">其它</h2>
        </header>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

onMounted(async () => {
  try {
    const data = await api.get("/homepage");
    sections.value = (data.sections || []).sort((a, b) => a.order - b.order);
    cards.value = data.cards || [];
    siteName.value = data.siteName || "栖枢";
    siteDescription.value = data.siteDescription || "";
    document.title = siteName.value;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});
</script>
