<!--
  SensitiveSettingInput
  ─────────────────────
  管理员后台「敏感配置项」输入框 — 比 PasswordInput 多一条规则:
  右侧的「显示 / 隐藏」按钮只在管理员"正在填写本字段"时才会出现。
  也就是说:

    · 字段未被改动、且当前没获得焦点 → 隐藏成 ●●●●●●,且不展示切换按钮。
      管理员/任何后续访问者都没法"事后偷看"已落库的敏感值。
    · 管理员点进字段开始改 → 切换按钮显形,这时可以临时切换到明文,
      方便核对自己刚刚粘贴/输入的内容是否正确。
    · 管理员保存 → 字段重新被父组件标记为"未修改",按钮自动消失,
      显示状态被强制重置回 password。

  这样既方便填写时核对,又保证日常浏览时不会泄露。
  父组件仅需透传 :is-modified="isModified(row.key)" 即可。
-->

<template>
  <div class="ssi-wrap">
    <input
      ref="inputEl"
      :type="effectiveType"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      @focus="onFocus"
      @blur="onBlur"
      class="input input-mono ssi-input"
      :class="{ 'ssi-input-padded': showToggle }"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      spellcheck="false"
    />
    <button
      v-if="showToggle"
      type="button"
      class="ssi-toggle"
      @mousedown.prevent
      @click="toggleReveal"
      :title="revealed ? '隐藏内容' : '显示内容'"
      :aria-label="revealed ? '隐藏内容' : '显示内容'"
      :aria-pressed="revealed"
      tabindex="-1"
    >
      <!-- eye-slash 当前为可见,按下后会隐藏 -->
      <svg v-if="revealed" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5 1.65 0 3.225-.323 4.66-.911M6.225 6.225A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.225 6.225 3 3m3.225 3.225 3.535 3.535m7.476 7.476L21 21m-3.764-3.764-3.535-3.535m0 0a3 3 0 1 0-4.243-4.243m4.243 4.243L9.876 9.88"/>
      </svg>
      <!-- eye 当前为隐藏,按下后会显示 -->
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  // 由父组件传:当前 dirty value 是否与已保存的原值不同。
  // 这是切换按钮可见性的核心依据 —— "正在改" 时才显形。
  isModified: { type: Boolean, default: false },
  placeholder: { type: String, default: "" },
  autocomplete: { type: String, default: "off" },
});

defineEmits(["update:modelValue"]);

const focused = ref(false);
const revealed = ref(false);

// 切换按钮的显形条件:聚焦中 OR 当前已被改动。
//   - 聚焦中:管理员刚点进来准备改,先把按钮亮出来,允许"边输边查"
//   - 已改动:管理员可能临时移焦再回来,只要还没保存就保留按钮
// 二者都不满足 → 按钮藏起来,且 effectiveType 强制 password,
// 即便 revealed 还是 true 也不会回显已落库的内容。
const showToggle = computed(() => focused.value || props.isModified);
const effectiveType = computed(() =>
  showToggle.value && revealed.value ? "text" : "password",
);

function onFocus() {
  focused.value = true;
}
function onBlur() {
  focused.value = false;
  // 离焦时若没有未保存的改动,顺带把"显示"状态收掉,
  // 防止下一次同一字段进入编辑时还沿用上次的 reveal 状态。
  if (!props.isModified) revealed.value = false;
}
function toggleReveal() {
  revealed.value = !revealed.value;
}

// 保存成功后父组件 isModified 由 true 跳回 false → 强制收起 reveal,
// 否则下次再编辑时会以"明文"出现,违反隐私要求。
watch(
  () => props.isModified,
  (now, prev) => {
    if (prev && !now) revealed.value = false;
  },
);
</script>

<style scoped>
.ssi-wrap {
  position: relative;
  display: block;
}
.ssi-input {
  width: 100%;
}
/* 仅在切换按钮显形时,腾出右侧 padding,避免长字符串顶到按钮 */
.ssi-input-padded {
  padding-right: 38px;
}
.ssi-toggle {
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
  transition: background-color 0.15s, color 0.15s, opacity 0.15s;
}
.ssi-toggle:hover {
  background-color: rgba(15, 36, 25, 0.06);
  color: var(--fg-dim);
}
.ssi-toggle:active {
  background-color: rgba(15, 36, 25, 0.10);
}
.ssi-toggle:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  background-color: rgba(15, 36, 25, 0.06);
}
</style>
