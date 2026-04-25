<template>
  <span :class="cls" class="badge">{{ label }}</span>
</template>

<script setup>
import { computed } from "vue";
const props = defineProps({ value: String });
const map = {
  public: { label: "公开", cls: "badge-slate" },
  user: { label: "用户", cls: "badge-accent" },
  member: { label: "成员", cls: "badge-emerald" },
  admin: { label: "管理员", cls: "badge-amber" },
};
const m = computed(() => map[props.value] || { label: props.value, cls: "badge-slate" });
const label = computed(() => m.value.label);
const cls = computed(() => m.value.cls);
</script>
