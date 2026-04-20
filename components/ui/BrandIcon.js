'use client';

/**
 * 栖枢 品牌图标 —— 候选合辑
 * ---------------------------------------------------------------------------
 * 前一版里"斜穿中轴"的设计被否决 —— 斜线观感粗糙、与周围文字相斥。
 * 这里重新提供 5 组候选,主题全部围绕"栖(停驻)"与"枢(门户 / 枢纽)":
 *
 *   1) rings    —— 同心环 + 中心点。纯几何,有"枢纽"的感觉,
 *                  极小尺寸(16px)仍然清晰。
 *   2) arch     —— 月亮门 / 拱形门廊。架构感,呼应"平台入口"。
 *   3) nest     —— 浅杯托一颗珠子,柔和,侧重"栖"的语义。
 *   4) lantern  —— 灯笼轮廓,圆润方正,东方意象但不俗气。
 *   5) cairn    —— 三重石垒,沉稳,禅意。
 *
 * 用法:
 *   <BrandIcon variant="rings" size={28} />
 *
 * 想切换整站的默认图标:修改下面的 DEFAULT_VARIANT 一个字符串即可。
 * 真正的 favicon 在 public/icon.svg,换默认后也请把那份同步过去
 * (或者直接让我替你换,告诉我你选了哪个)。
 *
 * 适配:16px(favicon)→ 28px(topbar)→ 64px(hero)→ 200px(splash)
 * 所有绘制都在 48 单位 viewBox 内,保持视觉一致。
 * ---------------------------------------------------------------------------
 */

export const DEFAULT_VARIANT = 'rings';
export const BRAND_VARIANTS = ['rings', 'arch', 'nest', 'lantern', 'cairn'];

const TONE_PALETTES = {
  jade: { stroke: '#4fa87b', accent: '#2f7c5a', bg: '#eff7f2', border: '#cfe6d8' },
  ink:  { stroke: '#1a1612', accent: '#3d3530', bg: '#faf8f5', border: '#ddd5cc' },
};

export default function BrandIcon({
  size = 28,
  withBackground = true,
  tone = 'jade',            // 'jade' | 'ink'
  variant = DEFAULT_VARIANT, // 'rings' | 'arch' | 'nest' | 'lantern' | 'cairn'
  title = '栖枢',
  className,
  style,
}) {
  const p = TONE_PALETTES[tone] || TONE_PALETTES.jade;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <title>{title}</title>
      {withBackground && (
        <rect
          x="0.5" y="0.5" width="47" height="47"
          rx="11" ry="11"
          fill={p.bg}
          stroke={p.border}
          strokeWidth="1"
        />
      )}
      {renderVariant(variant, p)}
    </svg>
  );
}

function renderVariant(variant, p) {
  switch (variant) {
    case 'arch':    return <ArchPaths p={p} />;
    case 'nest':    return <NestPaths p={p} />;
    case 'lantern': return <LanternPaths p={p} />;
    case 'cairn':   return <CairnPaths p={p} />;
    case 'rings':
    default:        return <RingsPaths p={p} />;
  }
}

// ── 1) rings:同心环 + 中心点 ─────────────────────────────────────────────
function RingsPaths({ p }) {
  return (
    <>
      <circle cx="24" cy="24" r="13" fill="none" stroke={p.stroke} strokeWidth="2.25" />
      <circle cx="24" cy="24" r="7"  fill="none" stroke={p.stroke} strokeWidth="1.4" opacity="0.75" />
      <circle cx="24" cy="24" r="2.4" fill={p.accent} />
    </>
  );
}

// ── 2) arch:月亮门 / 拱形门廊 ────────────────────────────────────────────
function ArchPaths({ p }) {
  return (
    <>
      {/* 拱门本体 —— 左右两根立柱 + 顶部半圆 */}
      <path
        d="M 13 34 L 13 23 A 11 11 0 0 1 35 23 L 35 34"
        fill="none"
        stroke={p.stroke}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 地面基线 */}
      <line x1="11" y1="36" x2="37" y2="36"
            stroke={p.stroke} strokeWidth="2" strokeLinecap="round" />
      {/* 门内的光 —— 一颗小圆点 */}
      <circle cx="24" cy="27" r="2.1" fill={p.accent} />
    </>
  );
}

// ── 3) nest:浅杯与珠子 ──────────────────────────────────────────────────
function NestPaths({ p }) {
  return (
    <>
      {/* 浅杯 —— 二次贝塞尔画一道柔和的"U" */}
      <path
        d="M 11 22 Q 24 40 37 22"
        fill="none"
        stroke={p.stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* 顶部小弧,给构图收口 */}
      <path
        d="M 16 20 Q 24 13 32 20"
        fill="none"
        stroke={p.stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* 珠子 —— 栖 */}
      <circle cx="24" cy="24" r="3" fill={p.accent} />
    </>
  );
}

// ── 4) lantern:灯笼轮廓 ─────────────────────────────────────────────────
function LanternPaths({ p }) {
  return (
    <>
      {/* 顶盖(挂钩与横梁) */}
      <line x1="19" y1="10" x2="29" y2="10"
            stroke={p.stroke} strokeWidth="2" strokeLinecap="round" />
      {/* 灯笼主体 —— 椭圆 */}
      <ellipse cx="24" cy="24" rx="10" ry="12"
               fill="none" stroke={p.stroke} strokeWidth="2.25" />
      {/* 主体中线(灯笼的骨架暗示) */}
      <line x1="14" y1="24" x2="34" y2="24"
            stroke={p.stroke} strokeWidth="1.2" opacity="0.5" />
      {/* 底部流苏 —— 小圆点 */}
      <circle cx="24" cy="39" r="1.8" fill={p.accent} />
      <line x1="24" y1="36" x2="24" y2="37.3"
            stroke={p.stroke} strokeWidth="1.2" opacity="0.55" />
    </>
  );
}

// ── 5) cairn:三重石垒 ──────────────────────────────────────────────────
function CairnPaths({ p }) {
  return (
    <>
      {/* 底石 —— 最宽 */}
      <rect x="10" y="30" width="28" height="6" rx="2.5"
            fill="none" stroke={p.stroke} strokeWidth="2" />
      {/* 中石 */}
      <rect x="14" y="21" width="20" height="6" rx="2.5"
            fill="none" stroke={p.stroke} strokeWidth="2" />
      {/* 顶石 —— 最窄,实心作为视觉焦点 */}
      <rect x="18" y="12" width="12" height="6" rx="2.5"
            fill={p.accent} />
    </>
  );
}
