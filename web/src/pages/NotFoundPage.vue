<template>
  <div class="text-center py-20 max-w-md mx-auto">
    <div class="inline-flex sigil-xl mx-auto mb-6 opacity-60"></div>
    <div class="font-display font-bold leading-none mb-4 text-fg" style="font-size: clamp(4.5rem, 12vw, 7rem); letter-spacing: -0.04em;">
      404<span class="text-teal-300">.</span>
    </div>
    <h1 class="h-section mb-3">页面不存在</h1>
    <p class="text-sm text-fg-dim mb-8 font-mono">{{ message }}</p>
    <a href="#/" class="btn btn-primary inline-flex">返回主页</a>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { route } from "../router.js";
import { currentUser } from "../session.js";

const message = computed(() => {
  if (route.path === "/admin" && (!currentUser.value || currentUser.value.role !== "admin")) {
    return "/admin · 需要管理员权限";
  }
  return route.path;
});
</script>
