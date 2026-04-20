import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { getSession } from '@/lib/auth.js';

/**
 * GET /api/homepage
 * 返回首页全部分区与卡片,每张卡片附上 accessible / lockReason。
 *
 * permission 语义(四档):
 *   public → 任何人可访问
 *   user   → 登录后可访问(包括 user / member / admin)
 *   member → 需要 member 或 admin 角色
 *   admin  → 仅 admin
 *
 * 首页不会过滤掉无权限的卡片,而是返回锁定态,让前端用遮罩展示,
 * 既告诉用户"这里有个功能",又不会泄露具体入口细节。
 *
 * 首页不再触发 favicon 懒刷新 —— 图标在各卡片首次被渲染时由
 * /api/favicons/image 自身按需抓取,之后不自动更新。管理员可在
 * /admin/favicons 手动批量/单条刷新。
 */
export async function GET() {
  const session = await getSession();
  const role = session?.user?.role || null;
  const isLoggedIn = !!session;

  const sections = db.findAll('sections').sort((a, b) => (a.order || 0) - (b.order || 0));
  const allCards = db.findAll('cards').sort((a, b) => (a.order || 0) - (b.order || 0));

  const annotate = (card) => {
    const perm = card.permission || 'public';
    let accessible = true;
    let lockReason = null;

    if (perm === 'user' && !isLoggedIn) {
      accessible = false; lockReason = 'user';
    } else if (perm === 'member' && role !== 'member' && role !== 'admin') {
      accessible = false; lockReason = 'member';
    } else if (perm === 'admin' && role !== 'admin') {
      accessible = false; lockReason = 'admin';
    }

    // H1 修复:真实 URL(以及 favicon 所依赖的 origin)对无权限用户是敏感的——
    // 管理员 / 会员入口、内网地址、运维面板都可能是"藏起来才安全"的链接。
    // 之前 `return { ...card, accessible, ... }` 会把 card.url 原样下发,
    // 只在前端通过遮罩阻止点击,但接口响应里仍然能被直接读到。
    //
    // 现在:锁定卡只下发必要的展示字段,url / description 都剔除;前端展示
    // "外部/内部"标签所需的 isExternal 在服务端判定后作为独立布尔传出,不再
    // 依赖客户端观察 url 前缀。
    const isExternal = typeof card.url === 'string' && card.url.startsWith('http');

    if (!accessible) {
      return {
        id: card.id,
        title: card.title,
        // description 可能带有"内网运维面板 / XX 服务管理端"等提示性文字,
        // 审查报告里建议"必要时连 description 一并裁剪",这里直接清空。
        description: '',
        sectionId: card.sectionId,
        order: card.order ?? 0,
        permission: perm,
        accessible: false,
        lockReason,
        isExternal,
      };
    }

    return {
      ...card,
      permission: perm,
      accessible: true,
      lockReason: null,
      isExternal,
    };
  };

  const annotated = allCards.map(annotate);
  const sectionIds = new Set(sections.map(s => s.id));
  const grouped = sections.map(section => ({
    ...section,
    cards: annotated.filter(c => c.sectionId === section.id),
  }));
  const ungrouped = annotated.filter(c => !c.sectionId || !sectionIds.has(c.sectionId));

  return NextResponse.json({ sections: grouped, ungrouped });
}
