import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function validatePasswordStrength(password) {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码长度至少为 8 位' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个大写字母' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个小写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个特殊字符' };
  }
  return { valid: true };
}
