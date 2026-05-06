-- 003_fix_oauth_scopes.sql
-- 修复已有 OAuth 客户端缺失的 OIDC 标准 scopes。
-- 问题背景：部分客户端（如 TaskFlow）注册时 scopes 只包含 ["openid"]，
-- 但第三方应用请求了 openid+profile+email。由于 token scope = 请求 ∩ 注册，
-- 结果只交集出 openid，导致 id_token 和 /userinfo 缺失用户名、邮箱等关键信息。
--
-- 本迁移自动为所有已有 openid 的客户端补全 profile 和 email scope，
-- 确保 OIDC 身份信息完整可用。

-- 为有 openid 但缺少 profile 的客户端追加 profile
UPDATE oauth_clients
SET scopes = json_insert(scopes, '$[#]', 'profile')
WHERE scopes LIKE '%"openid"%'
  AND scopes NOT LIKE '%"profile"%';

-- 为有 openid 但缺少 email 的客户端追加 email
UPDATE oauth_clients
SET scopes = json_insert(scopes, '$[#]', 'email')
WHERE scopes LIKE '%"openid"%'
  AND scopes NOT LIKE '%"email"%';
