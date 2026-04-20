/**
 * 静态 OAuth 客户端注册表
 * ===========================================================================
 * 这里列出的是"一等公民"级的 OAuth 接入方 —— 通常是同一组织内的姊妹应用
 * (如 BookFree / Alma Reader)、管理端工具、或可信第三方。它们的
 *
 *   • 元数据 (clientId / name / redirectUris / scopes / ...)
 *     直接在这个文件里声明,随代码一起进版本库 —— 它们是"配置",不是"数据"。
 *   • 秘钥 (client_secret)
 *     通过环境变量提供,不入库不入仓。字段名在 `secretEnv` 里声明。
 *
 * 运行时 `data/oauth_clients.json` 只保留管理员后台动态创建的客户端
 * (所谓"自助接入")。静态客户端的优先级始终高于动态客户端。
 *
 * 新增一个第三方接入:
 *   1) 在下面数组里加一条记录
 *   2) 在 .env 里补上对应的 secretEnv 值
 *   3) 重启 Profile 即可 —— 不需要跑 init,不需要改数据库
 *
 * scope 约定(与 app/api/oauth/userinfo 的 claim 过滤一致):
 *   openid      —— OIDC 必要,userinfo 端点的前置条件
 *   profile     —— name, picture(头像)
 *   email       —— email, email_verified
 *   qishu.role  —— role(自定。默认不授予,哪个 client 确实需要就把它加到
 *                   scopes 数组里)
 *
 * 关于 redirectUris:
 *   生产上 redirect URI 必须是 HTTPS(除了 http://localhost[:port] 这种本地
 *   开发例外)。下面的 sanityCheck 会在 NODE_ENV=production 启动时扫描整个
 *   列表,发现非 localhost 的 http:// 直接 throw,防止"上线忘了改"。
 * ===========================================================================
 */

export const STATIC_OAUTH_CLIENTS = [
  {
    clientId: 'qishu-default-client',
    name: '栖枢默认客户端',
    description: '用于平台内嵌应用与第一方 SDK 的默认 OAuth 客户端',
    homepageUrl: 'http://localhost:3000',
    logoUrl: '',
    minLevel: 0,
    // redirectUris 说明:
    //   • 下面两条 localhost 仅供本地开发(npm run dev)调试用 —— 生产环境请
    //     把你的真实 https 回调 append 进去(比如把本文件改成数组 +
    //     'https://profile.你的域名.com/api/auth/oauth/callback'),或者下掉 localhost
    //     留纯 https 列表。
    //   • sanityCheckStaticClients 在 NODE_ENV=production 下只对 localhost 打 warn,
    //     不阻止启动 —— 但那个 warn 就是提醒你"该改成真实域名了"。
    //   • 之前还有一条 http://localhost:3001/callback 已经删掉,避免给未使用的端
    //     口留白名单。
    redirectUris: [
      'http://localhost:3000/api/auth/oauth/callback',
      'http://localhost:3000/callback',
      // 'https://profile.example.com/api/auth/oauth/callback',  // ← 生产部署时打开并改成你的域名
    ],
    scopes: ['openid', 'profile', 'email'],
    status: 'active',
    secretEnv: 'QISHU_DEFAULT_CLIENT_SECRET',
  },
  // ── 在这里追加下一个接入方 ──
  // {
  //   clientId: 'some-partner-app',
  //   name: '某合作方应用',
  //   redirectUris: ['https://partner.example.com/oauth/callback'],
  //   scopes: ['openid', 'profile', 'email'],
  //   status: 'active',
  //   secretEnv: 'SOME_PARTNER_APP_SECRET',
  // },
];

/**
 * 启动时检查(#8 修复)
 * ---------------------------------------------------------------------------
 * 历史问题:默认 qishu-default-client 的 redirectUri 全是 localhost,生产
 * 上线时如果运营忘了替换为真实域名,OAuth 跳转会一直卡在 invalid_redirect_uri,
 * 这种"代码没 bug 但上线当天就炸"的情况很难排查。
 *
 * 这里在 NODE_ENV=production 下做一次启动扫描:
 *   • 任何非 localhost 的 http:// 开头的 redirect URI → 立刻 throw
 *   • 任何以 localhost / 127.0.0.1 / 0.0.0.0 开头的 redirect URI 在生产下
 *     打一条 warn(不 throw,因为某些场景比如同机多 service 也会用 localhost)
 *
 * 这个函数在 lib/oauthClients.js 里加载 STATIC_OAUTH_CLIENTS 时调用(见
 * 该文件同步修改)。
 */
export function sanityCheckStaticClients() {
  if (process.env.NODE_ENV !== 'production') return;

  for (const c of STATIC_OAUTH_CLIENTS) {
    if (!Array.isArray(c.redirectUris)) continue;
    for (const uri of c.redirectUris) {
      if (typeof uri !== 'string') continue;
      // https 一律通过
      if (uri.startsWith('https://')) continue;
      // http + localhost 系列打 warn(生产上一般不该这样,但不阻塞)
      if (/^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/.test(uri)) {
        console.warn(
          `[OAuth] 警告:生产环境下客户端 "${c.clientId}" 的 redirectUri "${uri}" ` +
          `是本地地址,很可能是上线前忘了替换的开发配置`
        );
        continue;
      }
      // 其他 http:// 直接报错 —— 生产上明文回调极危险(code 会跟着走明文链路)
      if (uri.startsWith('http://')) {
        throw new Error(
          `[OAuth] 生产环境下禁止非 HTTPS 的 redirectUri: ` +
          `client="${c.clientId}" uri="${uri}"。 ` +
          `请在 config/oauth-clients.js 把它改成 https://,或通过 /admin/clients 动态配置。`
        );
      }
    }
  }
}
