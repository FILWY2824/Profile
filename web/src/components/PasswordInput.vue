<template>
  <div class="pw-wrap">
    <input
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :required="required"
      :disabled="disabled"
      :minlength="minlength"
      :maxlength="maxlength"
      :name="name"
      class="input pw-input"
    />
    <button
      type="button"
      class="pw-toggle"
      @click="visible = !visible"
      :aria-label="visible ? '隐藏密码' : '显示密码'"
      :title="visible ? '隐藏密码' : '显示密码'"
      tabindex="-1"
    >
      <svg v-if="visible" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5 1.65 0 3.225-.323 4.66-.911M6.225 6.225A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.225 6.225 3 3m3.225 3.225 3.535 3.535m7.476 7.476L21 21m-3.764-3.764-3.535-3.535m0 0a3 3 0 1 0-4.243-4.243m4.243 4.243L9.876 9.88"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref } from "vue";

defineProps({
  modelValue: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  autocomplete: { type: String, default: "current-password" },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  minlength: { type: [Number, String], default: undefined },
  maxlength: { type: [Number, String], default: undefined },
  name: { type: String, default: undefined },
});

defineEmits(["update:modelValue"]);

const visible = ref(false);
</script>

<style scoped>
.pw-wrap {
  position: relative;
  display: block;
}
.pw-input {
  /* 留出右侧 toggle 按钮空间 */
  padding-right: 38px;
  width: 100%;
}
.pw-toggle {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--fg-mute);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.pw-toggle:hover {
  background-color: rgba(15, 36, 25, 0.06);
  color: var(--fg-dim);
}
.pw-toggle:active {
  background-color: rgba(15, 36, 25, 0.10);
}
.pw-toggle:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  background-color: rgba(15, 36, 25, 0.06);
}
</style>
