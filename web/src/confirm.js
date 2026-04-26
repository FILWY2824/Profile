// confirm.js — Promise-based replacement for window.confirm() and window.alert().
//
// 用法:
//   import { useConfirm } from "./confirm";
//   const ok = await useConfirm({ title: "删除会话", message: "确定吗?" });
//   if (!ok) return;
//
// ConfirmDialog 在 App.vue 顶层挂载一次,所有页面共用一个状态(单例)。
import { ref } from "vue";

export const confirmState = ref({
  open: false,
  title: "",
  message: "",
  detail: "",
  kind: "danger",            // "danger" | "info"
  confirmText: "确认",
  cancelText: "取消",
  _resolve: null,
});

export function useConfirm(opts = {}) {
  return new Promise((resolve) => {
    confirmState.value = {
      open: true,
      title: opts.title ?? "请确认",
      message: opts.message ?? "",
      detail: opts.detail ?? "",
      kind: opts.kind ?? "danger",
      confirmText: opts.confirmText ?? "确认",
      cancelText: opts.cancelText ?? "取消",
      _resolve: resolve,
    };
  });
}

export function closeConfirm(result) {
  const { _resolve } = confirmState.value;
  confirmState.value = { ...confirmState.value, open: false, _resolve: null };
  if (_resolve) _resolve(result);
}
