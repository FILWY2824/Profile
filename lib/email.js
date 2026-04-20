/**
 * 邮件发送 — 使用 Resend
 * ---------------------------------------------------------------------------
 * 所有配置项(RESEND_API_KEY / RESEND_FROM / SITE_NAME)都从 settings 表读。
 * 未配置时进入开发模式:不真实发送,code 原样通过返回值告诉前端显示。
 * 不再向 data/emails/ 写本地副本(避免单进程持续 IO 与潜在磁盘堆积)。
 *
 * 模板设计:
 *   • 整体走浅色 —— 米白(#faf8f5)底 + 奶油白(#fff)卡片,不再使用深色顶栏。
 *     邮件客户端的深色模式多数会自动反色,我们用浅色基调,收件方不管是白
 *     还是深色主题,观感都稳定,不会出现"深上加深"的糊色。
 *   • 图标与官网顶栏的 BrandIcon(rings 变体 + jade 配色)一致 —— 同心环 +
 *     中心点,翠绿描边。SVG 内联,邮件客户端不会去外链请求,也就不会因为
 *     图片拦截策略而裂图。viewBox / 尺寸与 BrandIcon 完全同步,便于日后改
 *     样式时只要同步这两处(BrandIcon.js 与此文件的 brandMarkSvg)。
 * ---------------------------------------------------------------------------
 */
import { getSetting } from './settings.js';

// 品牌色 —— 与 components/ui/BrandIcon.js 的 jade 调色板保持一致
const BRAND_STROKE = '#4fa87b';
const BRAND_ACCENT = '#2f7c5a';
const BRAND_BG     = '#eff7f2';
const BRAND_BORDER = '#cfe6d8';

/**
 * 和 BrandIcon 的 rings 变体严格同步(同心环 + 中心点)。
 * 如果将来在 BrandIcon.js 里切换默认图案或改色,记得也把这里同步过去 ——
 * 这里是邮件里的品牌图标,无法动态引用客户端组件。
 */
function brandMarkSvg(size = 38) {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="栖枢" style="display:block;">
  <rect x="0.5" y="0.5" width="47" height="47" rx="11" ry="11" fill="${BRAND_BG}" stroke="${BRAND_BORDER}" stroke-width="1"/>
  <circle cx="24" cy="24" r="13" fill="none" stroke="${BRAND_STROKE}" stroke-width="2.25"/>
  <circle cx="24" cy="24" r="7"  fill="none" stroke="${BRAND_STROKE}" stroke-width="1.4" opacity="0.75"/>
  <circle cx="24" cy="24" r="2.4" fill="${BRAND_ACCENT}"/>
</svg>`;
}

function codeEmailHtml(siteName, title, body) {
  // 外层 table 兼容性更好(Outlook 对 div/flex 支持糟糕,table 稳)。
  // 顶栏使用奶油白 + 浅米色下边框,与官网顶栏风格一致(都是浅色+淡边)。
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:'PingFang SC','Hiragino Sans GB',system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1612;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf8f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e5dfd9;overflow:hidden;">
          <tr>
            <td style="background:#ffffff;padding:22px 32px;border-bottom:1px solid #efe9e2;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">${brandMarkSvg(38)}</td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:1.1rem;font-weight:600;color:#1a1612;letter-spacing:-0.01em;line-height:1.1;">${siteName}</div>
                    <div style="font-size:0.68rem;color:#9e9087;letter-spacing:0.22em;margin-top:3px;text-transform:uppercase;">Qi · Shu</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <h2 style="margin:0 0 12px;color:#1a1612;font-size:1.2rem;font-weight:600;">${title}</h2>
              <p style="color:#6b5f57;font-size:0.92rem;line-height:1.75;margin:0 0 20px;">${body}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 32px 26px;color:#9e9087;font-size:0.78rem;line-height:1.6;">
              此邮件由 ${siteName} 平台自动发送,请勿回复。
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendViaResend({ apiKey, from, siteName }, to, subject, html) {
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `${siteName} <${from}>`,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

function loadEmailConfig() {
  return {
    siteName: getSetting('SITE_NAME') || '栖枢',
    apiKey: getSetting('RESEND_API_KEY') || '',
    from: getSetting('RESEND_FROM') || 'noreply@qishu.local',
  };
}

/**
 * 发送邮件的公共入口。
 * ---------------------------------------------------------------------------
 * 历史问题(#5):生产环境下,若 RESEND_API_KEY 未配置,原实现会走"开发模式":
 *   - 把验证码 console.log 到 stdout(日志里泄露敏感码)
 *   - 返回 { code },让上层 API 假装成功
 *   - 上层 API 又靠 NODE_ENV !== 'production' 过滤不把 code 回给前端
 *   - 最终结果:前端看到"邮件已发送",但用户邮箱永远收不到
 * 这条链路在生产上就是一个"注册看似成功,但用户完成不了"的静默黑洞。
 *
 * 修复策略:
 *   - NODE_ENV === 'production' 且 apiKey 为空 → 抛错,由上层 500,不走 dev 回显
 *   - 否则(开发态) → 保留旧行为:console.log + 返回 { code } 供前端回显
 * 上层 API (register / forgot-password / change-password 等)继续靠
 * NODE_ENV 决定是否把 devCode 回给前端,两层策略互相独立、叠加安全。
 * ---------------------------------------------------------------------------
 */
async function sendCodeEmail({ to, subject, html, code }) {
  const cfg = loadEmailConfig();

  if (!cfg.apiKey) {
    if (process.env.NODE_ENV === 'production') {
      // 在生产环境下,没有 apiKey = 真的发不出邮件。必须硬失败,不能静默成功。
      // 抛的错上游会被 catch,对外响应 500;运营能在日志里立刻看到这条,并去
      // /admin/settings 把 RESEND_API_KEY 填上。比用户反馈"我收不到验证码"
      // 早几天发现问题。
      throw new Error('邮件服务未配置(RESEND_API_KEY 为空),无法发送邮件');
    }
    // 开发态:把 code 打到 stdout 并返回给上层,让前端在 NODE_ENV!==production
    // 时能回显出来,便于本地调试。
    console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject} | Code: ${code}`);
    return { code };
  }

  await sendViaResend(cfg, to, subject, html);
  return {};
}

export async function sendVerificationCode(email, code) {
  const cfg = loadEmailConfig();
  const subject = `${cfg.siteName} 邮箱验证码`;
  const html = codeEmailHtml(
    cfg.siteName,
    '邮箱验证码',
    `您正在注册 ${cfg.siteName} 账号,验证码为:<br>
     <span style="font-size:2rem;font-weight:700;color:#1a1612;letter-spacing:0.2em;">${code}</span><br>
     验证码有效期 <strong>30 分钟</strong>,请勿泄露给他人。`
  );
  return sendCodeEmail({ to: email, subject, html, code });
}

export async function sendPasswordResetCode(email, code) {
  const cfg = loadEmailConfig();
  const subject = `${cfg.siteName} 密码重置验证码`;
  const html = codeEmailHtml(
    cfg.siteName,
    '密码重置验证码',
    `您正在重置 ${cfg.siteName} 账号密码,验证码为:<br>
     <span style="font-size:2rem;font-weight:700;color:#1a1612;letter-spacing:0.2em;">${code}</span><br>
     验证码有效期 <strong>30 分钟</strong>。如非本人操作,请忽略此邮件。`
  );
  return sendCodeEmail({ to: email, subject, html, code });
}
