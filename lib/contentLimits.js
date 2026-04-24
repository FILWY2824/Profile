/**
 * lib/contentLimits.js —— 管理员内容字段的长度上限
 * ---------------------------------------------------------------------------
 * 字段长度约束历史上散落在各 route 里,有的只靠前端 maxLength(绕过简单),
 * 有的漏了服务端校验。本文件把"对外展示字段"的上限集中在一处,调用方用
 * `validateContentField(KIND, value)` 得到规范化值或错误消息。
 *
 * 限额值的取舍:
 *   • 标题类(title/name):64 字符。UI 上一行基本就显示完,超长反而难看。
 *   • slug:40 字符 + 正则 `^[a-z0-9-]+$`。
 *   • 描述类(description):500 字符。卡片副标题、板块说明、OAuth 客户端介绍
 *     都走这个档;一屏能读完的量。
 *   • bio:200 字符。仅在个人资料页展示。
 *   • URL:2000 字符。浏览器地址栏的实际上限通常 ≤ 2048,这里再留一点余量。
 *
 * 所有长度以 JS 字符串 `.length`(UTF-16 code units)计,和前端 `<input maxLength>`
 * 计数规则一致。emoji 会被计为 2 —— 这是浏览器的默认,体验上对齐。
 * ---------------------------------------------------------------------------
 */

const LIMITS = {
  title:       { min: 1, max: 64,   allowEmpty: false, label: '标题' },
  name:        { min: 1, max: 64,   allowEmpty: false, label: '名称' },
  slug:        { min: 1, max: 40,   allowEmpty: false, label: 'slug', regex: /^[a-z0-9-]+$/, regexMessage: 'slug 只能包含小写字母、数字和连字符' },
  description: { min: 0, max: 500,  allowEmpty: true,  label: '描述' },
  bio:         { min: 0, max: 200,  allowEmpty: true,  label: '个人简介' },
  url:         { min: 1, max: 2000, allowEmpty: false, label: 'URL' },
};

/**
 * @param {keyof typeof LIMITS} kind
 * @param {unknown} raw
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateContentField(kind, raw) {
  const spec = LIMITS[kind];
  if (!spec) {
    // 调用方传了未登记的 kind —— 视为程序错误,空防御性返回
    return { valid: false, message: '未知字段类型' };
  }

  if (raw == null) raw = '';
  if (typeof raw !== 'string') {
    return { valid: false, message: `${spec.label} 必须是字符串` };
  }

  const value = raw.trim();

  if (!value) {
    if (spec.allowEmpty) return { valid: true, value: '' };
    return { valid: false, message: `${spec.label}不能为空` };
  }

  if (value.length < spec.min) {
    return { valid: false, message: `${spec.label}长度至少 ${spec.min} 个字符` };
  }
  if (value.length > spec.max) {
    return { valid: false, message: `${spec.label}长度不能超过 ${spec.max} 个字符` };
  }

  if (spec.regex && !spec.regex.test(value)) {
    return { valid: false, message: spec.regexMessage || `${spec.label} 格式不合法` };
  }

  return { valid: true, value };
}

/**
 * 暴露上限常量,方便前端/文档引用同一数值(如果将来引入 shared 包)。
 */
export const CONTENT_LIMITS = Object.freeze(
  Object.fromEntries(
    Object.entries(LIMITS).map(([k, v]) => [k, { min: v.min, max: v.max }])
  )
);
