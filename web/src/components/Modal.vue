<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="$emit('close')">
    <div class="fixed inset-0 bg-ink-950/40 backdrop-blur-sm" @click="$emit('close')" />
    <div class="card relative z-10 w-full max-w-md p-6">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-900">{{ title }}</h2>
        <button @click="$emit('close')" class="text-ink-400 hover:text-ink-600">✕</button>
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({ title: String });
defineEmits(["close"]);
</script>
