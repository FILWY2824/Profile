<template>
  <div class="space-y-8">
    <section v-if="!loading && cards.length === 0" class="card p-8 text-center text-ink-500">
      暂无内容,管理员可在
      <a v-if="user && user.role === 'admin'" href="#/admin" class="text-ink-600 underline">管理后台</a>
      <span v-else>登录后</span>
      添加。
    </section>

    <section v-for="s in sectionsWithCards" :key="s.id" class="space-y-3">
      <header>
        <h2 class="text-lg font-semibold text-ink-900">{{ s.name }}</h2>
        <p v-if="s.description" class="text-sm text-ink-500">{{ s.description }}</p>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CardTile v-for="c in s.cards" :key="c.id" :card="c" />
      </div>
    </section>

    <!-- "Other" bucket for cards without a section -->
    <section v-if="orphanCards.length > 0" class="space-y-3">
      <h2 class="text-lg font-semibold text-ink-900">其他</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CardTile v-for="c in orphanCards" :key="c.id" :card="c" />
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api.js";
import { currentUser } from "../session.js";
import CardTile from "../components/CardTile.vue";

const sections = ref([]);
const cards = ref([]);
const loading = ref(true);
const user = currentUser;

async function load() {
  loading.value = true;
  try {
    const r = await api.get("/homepage");
    sections.value = (r.sections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    cards.value = (r.cards || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  } finally {
    loading.value = false;
  }
}

const sectionsWithCards = computed(() =>
  sections.value
    .map((s) => ({ ...s, cards: cards.value.filter((c) => c.sectionId === s.id) }))
    .filter((s) => s.cards.length > 0),
);

const orphanCards = computed(() =>
  cards.value.filter((c) => !c.sectionId || !sections.value.find((s) => s.id === c.sectionId)),
);

onMounted(load);
</script>
