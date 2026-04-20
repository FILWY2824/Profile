/**
 * lib/oauthTemplates.js
 * ===========================================================================
 * 新建 OAuth 客户端的"快速模板"预设 —— 给管理员一个一键填满所有字段的起点,
 * 改两个地方就能提交,不用每次都从空白表单开始抄文档。
 *
 * 模板只是表单初始值,不影响后端校验;改字段或换模板不会触发任何网络请求。
 *
 * 字段对齐 app/admin/oauth-clients/new/page.js 的 form state 结构:
 *   clientId, name, description, homepageUrl, logoUrl,
 *   minLevel (0 任何登录 / 1 会员及以上 / 2 仅管理员),
 *   redirectUrisText (每行一条),
 *   scopes (字符串数组)
 *
 * clientId 遵守后端的 3-64 位小写字母/数字/._- 约束,管理员几乎一定要改;
 * 这里的样例值用 my-xxx 前缀,提示"这是模板,请替换"。
 * ===========================================================================
 */

export const OAUTH_TEMPLATES = [
  {
    id: 'blank',
    name: '空白表单',
    description: '清空所有字段,从零开始手动填写',
    form: {
      clientId: '',
      name: '',
      description: '',
      homepageUrl: '',
      logoUrl: '',
      minLevel: 0,
      redirectUrisText: '',
      scopes: ['openid', 'profile', 'email'],
    },
  },
  {
    id: 'spa',
    name: 'OIDC 单页应用 (SPA)',
    description: '前端直连,推荐搭配 PKCE。常用于 React / Vue / SvelteKit',
    form: {
      clientId: 'my-spa-app',
      name: 'My SPA App',
      description: '基于浏览器的单页应用,通过前端路由回调',
      homepageUrl: 'https://app.example.com',
      logoUrl: '',
      minLevel: 0,
      redirectUrisText:
        'https://app.example.com/auth/callback\n' +
        'http://localhost:5173/auth/callback',
      scopes: ['openid', 'profile', 'email'],
    },
  },
  {
    id: 'webapp',
    name: 'OIDC 服务端应用',
    description: '后端持有 secret,回调打到后端接口(Next.js / Express / Rails)',
    form: {
      clientId: 'my-web-app',
      name: 'My Web App',
      description: '服务端渲染或 BFF 架构的 Web 应用',
      homepageUrl: 'https://www.example.com',
      logoUrl: '',
      minLevel: 0,
      redirectUrisText:
        'https://www.example.com/oauth/callback\n' +
        'http://localhost:3000/oauth/callback',
      scopes: ['openid', 'profile', 'email'],
    },
  },
  {
    id: 'admin-tool',
    name: '仅管理员工具',
    description: '仅 admin 角色可授权,适合内部工单/运维/数据看板',
    form: {
      clientId: 'internal-admin',
      name: '内部管理工具',
      description: '仅限管理员使用的后台工具',
      homepageUrl: 'https://admin.example.com',
      logoUrl: '',
      minLevel: 2,
      redirectUrisText:
        'https://admin.example.com/oauth/callback\n' +
        'http://localhost:3100/oauth/callback',
      scopes: ['openid', 'profile', 'email', 'qishu.role'],
    },
  },
  {
    id: 'member-app',
    name: '会员专属应用',
    description: '仅会员及以上可授权,适合付费功能接入',
    form: {
      clientId: 'member-app',
      name: 'Member App',
      description: '仅限会员账号使用的应用',
      homepageUrl: 'https://members.example.com',
      logoUrl: '',
      minLevel: 1,
      redirectUrisText: 'https://members.example.com/oauth/callback',
      scopes: ['openid', 'profile', 'email', 'qishu.role'],
    },
  },
];

export function getTemplate(id) {
  return OAUTH_TEMPLATES.find(t => t.id === id) || OAUTH_TEMPLATES[0];
}
