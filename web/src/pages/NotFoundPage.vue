<template>
  <div class="text-center py-24 max-w-md mx-auto">
    <div class="archive-no mb-3">ERR · № 404</div>
    <div class="rule-h-strong mb-6"></div>
    <div class="font-display leading-none mb-3" style="font-size: clamp(5rem, 14vw, 8rem); font-variation-settings:'opsz' 144, 'SOFT' 80;">
      404<span class="text-cinnabar">.</span>
    </div>
    <h1 class="h-section mb-3">未在档案中检索到此页</h1>
    <p class="text-sm text-ash mb-2 font-mono">{{ message }}</p>
    <div class="rule-h my-6 mx-auto w-24"></div>
    <a href="#/" class="btn btn-primary inline-flex">
      <span class="archive-no" style="color:inherit;letter-spacing:0.3em;">← 返回首页</span>
    </a>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { route } from "../router.js";
import { currentUser } from "../session.js";

const message = computed(() => {
  if (route.path === "/admin" && (!currentUser.value || currentUser.value.role !== "admin")) {
    return "PATH /admin · 需要管理员权限";
  }
  return `PATH ${route.path}`;
});
</script>
