<template>
  <div class="text-center py-20">
    <div class="text-6xl mb-3">🔍</div>
    <h1 class="h-page mb-2">页面未找到</h1>
    <p class="text-muted">{{ message }}</p>
    <a href="#/" class="btn-secondary mt-6">返回首页</a>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { route } from "../router.js";
import { currentUser } from "../session.js";

const message = computed(() => {
  if (route.path === "/admin" && (!currentUser.value || currentUser.value.role !== "admin")) {
    return "需要管理员权限";
  }
  return route.path;
});
</script>
