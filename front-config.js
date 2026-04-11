export const ROLE_LABELS = {
  guest: "访客",
  normal: "用户",
  member: "会员",
  admin: "管理员"
};

export const ROLE_LEVELS = {
  guest: 0,
  normal: 1,
  member: 2,
  admin: 3
};

export const USER_STATUS_LABELS = {
  active: "正常",
  suspended: "停用"
};

export const AUTH_TITLES = {
  login: "登录账号",
  register: "邮箱注册",
  reset: "找回密码"
};

export const DEFAULT_PORTAL_CONFIG = {
  site: {
    brandTag: "QISHU SERVICE OS",
    title: "栖枢",
    lead:
      "把知识、工具、服务与协作能力聚拢为一座个人中枢。借助 AI 与云端部署，一个人也可以像一支团队那样持续学习、快速开发、稳定交付。",
    authNote: "支持邮箱注册、验证码验证、资料维护与分级访问控制。",
    adminEntryLabel: "进入控制台"
  },
  sections: [
    {
      id: "forum",
      tag: "Forum Zone",
      title: "论坛专区",
      accent: "#8f95ff",
      accentDeep: "#6e73e8",
      glow: "rgba(143, 149, 255, 0.16)",
      shadow: "rgba(143, 149, 255, 0.2)",
      items: [
        {
          key: "blog-system",
          name: "博客系统",
          badge: "Blog",
          glyph: "博",
          summary: "统一进入你的论坛与博客服务。",
          requiredRole: "guest",
          enabled: true
        }
      ]
    },
    {
      id: "ai",
      tag: "AI Zone",
      title: "AI专区",
      accent: "#67a8ff",
      accentDeep: "#4d83f3",
      glow: "rgba(103, 168, 255, 0.16)",
      shadow: "rgba(103, 168, 255, 0.22)",
      items: [
        {
          key: "grok2-api",
          name: "Grok2API",
          badge: "API",
          glyph: "G2",
          summary: "模型调用与接口服务入口。",
          requiredRole: "guest",
          enabled: true
        },
        {
          key: "cli-proxy-api",
          name: "CLI Proxy API",
          badge: "Proxy",
          glyph: "CP",
          summary: "命令行代理与接口能力入口。",
          requiredRole: "guest",
          enabled: true
        }
      ]
    },
    {
      id: "tools",
      tag: "Tools Zone",
      title: "工具专区",
      accent: "#f0ad63",
      accentDeep: "#dd8f3e",
      glow: "rgba(240, 173, 99, 0.16)",
      shadow: "rgba(240, 173, 99, 0.2)",
      items: [
        {
          key: "register-tool",
          name: "注册机",
          badge: "Tool",
          glyph: "注",
          summary: "常用工具服务入口。",
          requiredRole: "guest",
          enabled: true
        },
        {
          key: "proxy-pool",
          name: "代理池",
          badge: "Pool",
          glyph: "池",
          summary: "代理资源管理入口。",
          requiredRole: "guest",
          enabled: true
        },
        {
          key: "server-monitor",
          name: "服务器监控",
          badge: "Admin",
          glyph: "监",
          summary: "仅管理员可访问的监控入口。",
          requiredRole: "admin",
          enabled: true
        }
      ]
    },
    {
      id: "games",
      tag: "Game Zone",
      title: "游戏专区",
      accent: "#ef7ea0",
      accentDeep: "#d76084",
      glow: "rgba(239, 126, 160, 0.16)",
      shadow: "rgba(239, 126, 160, 0.2)",
      items: [
        {
          key: "landlords",
          name: "斗地主",
          badge: "Game",
          glyph: "斗",
          summary: "游戏主站入口。",
          requiredRole: "guest",
          enabled: true
        }
      ]
    }
  ]
};

export const createDefaultPortalConfig = () => JSON.parse(JSON.stringify(DEFAULT_PORTAL_CONFIG));
