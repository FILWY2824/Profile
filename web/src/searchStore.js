// 全局搜索状态:
// 顶部 NavBar 提供输入框,HomePage 订阅并过滤卡片。
// 简单单文件单例 ref,跨组件共享(无需 Pinia)。
import { ref } from "vue";

export const globalSearch = ref("");

export function clearSearch() {
  globalSearch.value = "";
}
