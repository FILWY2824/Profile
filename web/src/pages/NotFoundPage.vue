<template>
  <div class="text-center py-20 max-w-md mx-auto">
    <div class="inline-flex sigil-xl mx-auto mb-6"></div>
    <div class="not-found-num">
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

<style scoped>
.not-found-num {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-variation-settings: "opsz" 96;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 16px;
  font-size: clamp(4.5rem, 12vw, 7rem);
  letter-spacing: -0.04em;
  background: linear-gradient(120deg, #047857, #10B981 50%, #06B6D4);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.not-found-num .text-teal-300 {
  -webkit-text-fill-color: var(--brand);
  background: none;
}
</style>
