<template>
  <span class="badge" :class="cls" v-if="show">{{ label }}</span>
</template>

<script setup>
import { computed } from "vue";
const props = defineProps({ perm: String });
const show = computed(() => props.perm && props.perm !== "public");
const label = computed(
  () => ({ user: "登录", member: "会员", admin: "管理员" }[props.perm] || props.perm),
);
const cls = computed(
  () =>
    ({
      user: "bg-ink-100 text-ink-700",
      member: "bg-amber-100 text-amber-800",
      admin: "bg-rose-100 text-rose-800",
    }[props.perm] || "bg-ink-100 text-ink-700"),
);
</script>
