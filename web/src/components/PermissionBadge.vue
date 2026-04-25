<template>
  <span :class="['badge', cls]">{{ label }}</span>
</template>

<script setup>
import { computed } from "vue";
const props = defineProps({ role: String });
const cls = computed(() => {
  if (props.role === "admin") return "badge-cinnabar";
  if (props.role === "member") return "badge-ink";
  return "badge-ash";
});
const label = computed(() => ({
  admin: "ADMIN",
  member: "MEMBER",
  user: "USER",
})[props.role] || (props.role || "—").toUpperCase());
</script>
