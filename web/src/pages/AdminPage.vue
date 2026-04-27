<template>
  <!-- 关键:布局结构必须与 NavBar.vue 严格一致才能让两者左右边界对齐。
       NavBar 用的是 `outer:px-4 sm:px-6 lg:px-8` 包 `inner:mx-auto max-w-7xl`,
       padding 在 max-width 之外。如果反过来(把 padding 放在 max-width 容器内),
       当视口 > 1280px 时 max-w-7xl 就会被钉在 1280px 居中,内部 padding 又把
       内容再向中央挤 32px,结果 admin-shell 比 nav-glass 内缩 32px — 这是
       原版的对齐 bug。
       正确做法:`admin-outer` 满视口 + 与顶栏同款 padding,`admin-inner` 内部
       `mx-auto max-w-7xl` 无 padding。这样 `.admin-shell` 的左右边界与顶栏
       `.nav-glass` 完全一致。 -->
  <div class="admin-outer">
   <div class="admin-inner">
    <div class="admin-shell">
      <aside class="admin-sidebar hidden md:flex flex-col">
        <div class="admin-brand">
          <div class="admin-brand-name">管理后台</div>
          <div class="admin-brand-sub">ADMIN PANEL</div>
        </div>
        <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          <div class="admin-group">
            <div class="admin-group-label">
              <span>概览</span>
              <span class="admin-group-line"></span>
            </div>
            <button v-for="t in topTabs" :key="t.id"
                    @click="active = t.id"
                    :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
              {{ t.label }}
            </button>
          </div>
          <div class="admin-group">
            <div class="admin-group-label">
              <span>内容</span>
              <span class="admin-group-line"></span>
            </div>
            <button v-for="t in contentTabs" :key="t.id"
                    @click="active = t.id"
                    :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
              {{ t.label }}
            </button>
          </div>
          <div class="admin-group">
            <div class="admin-group-label">
              <span>系统</span>
              <span class="admin-group-line"></span>
            </div>
            <button v-for="t in systemTabs" :key="t.id"
                    @click="active = t.id"
                    :class="['admin-side-item', active === t.id && 'admin-side-item-active']">
              {{ t.label }}
            </button>
          </div>
        </nav>
        <div class="admin-foot">{{ today }}</div>
      </aside>

      <!-- 移动端 tab -->
      <div class="admin-mobile-tabs md:hidden">
        <button v-for="t in [...topTabs, ...contentTabs, ...systemTabs]" :key="t.id"
                @click="active = t.id"
                :class="[
                  'inline-flex items-center px-3 py-1.5 rounded-md text-xs mr-1 transition-colors whitespace-nowrap',
                  active === t.id ? 'admin-mobile-tab-active' : 'text-fg-dim'
                ]">
          {{ t.label }}
        </button>
      </div>

      <!-- 主内容 — 独立滚动 -->
      <main class="admin-main">
        <div class="admin-main-inner">
          <component :is="activeView" />
        </div>
      </main>
    </div>
   </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { formatDate } from "../format.js";

import DashboardTab from "../components/admin/DashboardTab.vue";
import UsersTab from "../components/admin/UsersTab.vue";
import SectionsTab from "../components/admin/SectionsTab.vue";
import CardsTab from "../components/admin/CardsTab.vue";
import FaviconsTab from "../components/admin/FaviconsTab.vue";
import OAuthClientsTab from "../components/admin/OAuthClientsTab.vue";
import SettingsTab from "../components/admin/SettingsTab.vue";
import AuditTab from "../components/admin/AuditTab.vue";

const topTabs = [{ id: "dashboard", label: "总览" }];
const contentTabs = [
  { id: "sections", label: "板块" },
  { id: "cards",    label: "卡片" },
  { id: "favicons", label: "图标缓存" },
];
const systemTabs = [
  { id: "users",    label: "用户" },
  { id: "oauth",    label: "OAuth 客户端" },
  { id: "settings", label: "系统设置" },
  { id: "audit",    label: "审计日志" },
];

const active = ref("dashboard");
const map = {
  dashboard: DashboardTab,
  users: UsersTab,
  sections: SectionsTab,
  cards: CardsTab,
  favicons: FaviconsTab,
  oauth: OAuthClientsTab,
  settings: SettingsTab,
  audit: AuditTab,
};
const activeView = computed(() => map[active.value]);

// 用统一的 Asia/Shanghai 时区显示。原来的 new Date().getMonth() 等是浏览器
// 本地时区,用户在国外浏览时可能看到错位。
const today = computed(() => formatDate());
</script>

<style scoped>
/* 外层容器 — 必须与 NavBar 的最外层 `<nav class="px-4 sm:px-6 lg:px-8">`
   规格完全一致:满视口宽 + 与顶栏同 padding,padding 必须在 max-width 之外。
   App.vue 在 has-sidebar 模式下让 main 占满高度并 overflow:hidden,所以
   admin-outer 也要 height:100% 并 overflow:hidden;真正的滚动让 admin-main
   自己处理。 */
.admin-outer {
  height: 100%;
  width: 100%;
  padding: 0 1rem;        /* tailwind px-4 */
  overflow: hidden;
}
@media (min-width: 640px) {
  .admin-outer { padding-left: 1.5rem; padding-right: 1.5rem; } /* sm:px-6 */
}
@media (min-width: 1024px) {
  .admin-outer { padding-left: 2rem; padding-right: 2rem; }     /* lg:px-8 */
}

/* 内层容器 — 与 NavBar 的 `<div class="mx-auto max-w-7xl">` 一一对应,
   不能再加任何 padding。这里是真正决定 admin-shell 左右边界的层。 */
.admin-inner {
  height: 100%;
  width: 100%;
  margin: 0 auto;
  max-width: 80rem;       /* tailwind max-w-7xl */
}

.admin-shell {
  display: flex;
  height: 100%;
  width: 100%;
}

/* 侧边栏 — 玻璃面板,左缘对齐顶栏 brand 起点。 */
.admin-sidebar {
  width: 14.5rem;
  flex-shrink: 0;
  background-color: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 18px;
  height: 100%;
  display: flex;
  flex-direction: column;
  margin: 8px 0 8px 0;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.85) inset,
    0 8px 24px -12px rgba(15, 36, 25, 0.10);
}

.admin-brand {
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(15, 36, 25, 0.06);
}
.admin-brand-name {
  font-family: "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.018em;
  color: var(--fg);
  line-height: 1;
}
.admin-brand-sub {
  font-size: 10px;
  color: var(--fg-mute);
  margin-top: 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.08em;
}

/* 分组(概览 / 内容 / 系统)— 必须明显是分组标题而不是按钮。
   做法:
     - 缩小到 10px,加 letter-spacing 和 uppercase
     - 后跟一根细横线,延伸到分组项的右缘 —— 这是排版里"上面是 label,下面才是
       项目"最朴素也最有效的视觉分隔。
     - 不允许 hover、不可点击,cursor 也不变。 */
.admin-group { display: flex; flex-direction: column; gap: 1px; }
.admin-group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  margin-bottom: 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--fg-mute);
  text-transform: uppercase;
  letter-spacing: 0.10em;
  user-select: none;
  cursor: default;
}
.admin-group-label > span:first-child {
  flex-shrink: 0;
  white-space: nowrap;
}
.admin-group-line {
  flex: 1;
  height: 1px;
  background-color: rgba(15, 36, 25, 0.10);
}

/* 侧边栏菜单项 */
.admin-side-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-dim);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.admin-side-item:hover {
  background-color: rgba(255, 255, 255, 0.55);
  color: var(--fg);
}
.admin-side-item-active {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.55), rgba(110, 231, 183, 0.40));
  color: var(--brand-deep);
  font-weight: 600;
  border-color: rgba(110, 231, 183, 0.45);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.admin-side-item-active:hover {
  background: linear-gradient(135deg, rgba(167, 243, 208, 0.7), rgba(110, 231, 183, 0.55));
}

.admin-foot {
  border-top: 1px solid rgba(15, 36, 25, 0.06);
  padding: 12px 22px;
  font-size: 11px;
  color: var(--fg-mute);
  font-family: "JetBrains Mono", ui-monospace, monospace;
}

/* 主区 — 独立滚动 */
.admin-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
}
.admin-main-inner {
  padding: 24px 0 24px 24px;
}
@media (max-width: 768px) {
  .admin-main-inner { padding: 12px; }
}

/* 移动端水平 tab — 仅在窄屏出现 */
.admin-mobile-tabs {
  position: sticky;
  top: 0;
  z-index: 20;
  margin: 12px 0 0;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow-x: auto;
  white-space: nowrap;
  padding: 8px;
  box-shadow: 0 8px 24px -10px rgba(15, 36, 25, 0.10);
}
.admin-mobile-tab-active {
  background: linear-gradient(135deg, #34D399, #10B981 60%, #047857);
  color: #fff !important;
  font-weight: 600;
  box-shadow: 0 4px 10px -3px rgba(16, 185, 129, 0.45);
}

/* 窄屏时 admin-shell 改成纵向 */
@media (max-width: 768px) {
  .admin-outer { overflow: visible; height: auto; }
  .admin-inner { height: auto; }
  .admin-shell { flex-direction: column; height: auto; }
  .admin-main { height: auto; }
  .admin-sidebar { display: none; }
}
</style>
