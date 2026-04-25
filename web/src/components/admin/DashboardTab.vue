<template>
  <div v-if="loading" class="card p-6 text-center text-ink-500">加载中…</div>
  <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Stat label="用户总数" :value="data.users.total" />
    <Stat label="管理员" :value="data.users.byRole?.admin || 0" tone="rose" />
    <Stat label="会员" :value="data.users.byRole?.member || 0" tone="amber" />
    <Stat label="普通用户" :value="data.users.byRole?.user || 0" />
    <Stat label="板块" :value="data.sections" />
    <Stat label="卡片" :value="data.cards" />
  </div>
</template>

<script setup>
import { ref, onMounted, h } from "vue";
import { api } from "../../api.js";

const Stat = (props) =>
  h("div", { class: "card p-4" }, [
    h("div", { class: "text-xs uppercase tracking-wide text-ink-500" }, props.label),
    h(
      "div",
      {
        class: {
          "mt-1 text-2xl font-semibold": true,
          "text-rose-700": props.tone === "rose",
          "text-amber-700": props.tone === "amber",
          "text-ink-900": !props.tone,
        },
      },
      props.value,
    ),
  ]);

const data = ref({ users: { total: 0, byRole: {} }, sections: 0, cards: 0 });
const loading = ref(true);
onMounted(async () => {
  try {
    data.value = await api.get("/admin/dashboard");
  } finally {
    loading.value = false;
  }
});
</script>
