<template>
  <span :class="['badge', cls]">{{ label }}</span>
</template>

<script setup>
import { computed } from "vue";
const props = defineProps({
  role: String,
  value: String,
});

// 兼容 role 和 value 两种 prop 名 (原代码有不一致用法)
const v = computed(() => props.role || props.value || "");

const cls = computed(() => {
  const x = v.value;
  if (x === "admin")  return "badge-amber";
  if (x === "member") return "badge-emerald";
  if (x === "user")   return "badge-slate";
  if (x === "public") return "badge-emerald";
  return "badge-slate";
});

const label = computed(() => ({
  admin:  "管理员",
  member: "成员",
  user:   "用户",
  public: "公开",
})[v.value] || (v.value || "—").toUpperCase());
</script>
