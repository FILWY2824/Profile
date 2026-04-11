const RESEND_API_URL = "https://api.resend.com/emails";

const PURPOSE_COPY = {
  register: {
    title: "注册验证码",
    actionText: "完成账号注册"
  },
  "reset-password": {
    title: "找回密码验证码",
    actionText: "重置你的账号密码"
  },
  "change-email": {
    title: "修改邮箱验证码",
    actionText: "验证你的新邮箱地址"
  }
};

const createVerificationText = ({ title, greetingName, actionText, code, ttlMinutes }) =>
  [
    `你好，${greetingName}：`,
    "",
    `你的${title}是：${code}`,
    `该验证码用于${actionText}，${ttlMinutes} 分钟内有效。`,
    "",
    "如果这不是你的操作，请忽略这封邮件。"
  ].join("\n");

const createVerificationHtml = ({ title, greetingName, actionText, code, ttlMinutes }) => `
  <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.8;color:#182230;">
    <h2 style="margin:0 0 12px;">${title}</h2>
    <p>你好，${greetingName}：</p>
    <p>你的验证码为：</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:12px 0;color:#466fda;">${code}</p>
    <p>该验证码用于${actionText}，${ttlMinutes} 分钟内有效。</p>
    <p>如果这不是你的操作，请忽略这封邮件。</p>
  </div>
`;

const createResendError = async (response) => {
  let details = null;

  try {
    details = await response.json();
  } catch {
    details = null;
  }

  if (response.status === 401 || response.status === 403) {
    return new Error("Resend API Key 无效，或当前发信域名尚未完成验证。");
  }

  if (response.status === 422) {
    return new Error(details?.message || "Resend 请求参数无效，请检查发件邮箱是否已在 Resend 中可用。");
  }

  return new Error(details?.message || `Resend 请求失败，状态码 ${response.status}。`);
};

const createMailService = (config) => {
  const apiKey = config.mail.resendApiKey.trim();

  const getStatus = () => ({
    enabled: Boolean(apiKey),
    provider: config.mail.provider,
    from: config.mail.from,
    replyTo: config.mail.replyTo
  });

  const sendWithResend = async ({ email, subject, text, html }) => {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [email],
        reply_to: config.mail.replyTo,
        subject,
        text,
        html
      })
    });

    if (!response.ok) {
      throw await createResendError(response);
    }

    return response.json();
  };

  const sendVerificationCode = async ({ purpose, email, displayName, code }) => {
    const copy = PURPOSE_COPY[purpose];
    if (!copy) {
      throw new Error("不支持的验证码用途。");
    }

    const greetingName = displayName || email;
    const ttlMinutes = Math.max(1, Math.round(config.auth.verificationTtlMs / 60000));
    const subject = `${config.app.name} ${copy.title}`;
    const text = createVerificationText({
      title: copy.title,
      greetingName,
      actionText: copy.actionText,
      code,
      ttlMinutes
    });
    const html = createVerificationHtml({
      title: copy.title,
      greetingName,
      actionText: copy.actionText,
      code,
      ttlMinutes
    });

    if (!apiKey) {
      if (!config.mail.devLogCodes) {
        throw new Error("Resend 未配置，请先设置 RESEND_API_KEY。");
      }

      console.log(`[qishu] resend disabled, ${purpose} code for ${email}: ${code}`);
      console.log(text);

      return {
        mode: "console"
      };
    }

    await sendWithResend({
      email,
      subject,
      text,
      html
    });

    return {
      mode: "email"
    };
  };

  return {
    getStatus,
    sendVerificationCode
  };
};

module.exports = {
  createMailService
};
