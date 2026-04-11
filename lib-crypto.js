const { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(scrypt);

const createId = (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`;
const createToken = (bytes = 24) => randomBytes(bytes).toString("hex");
const hashValue = (value) => createHash("sha256").update(value).digest("hex");

const createNumericCode = (length = 6) => {
  if (length <= 0) {
    throw new Error("Verification code length must be positive.");
  }

  const minimum = 10 ** (length - 1);
  const maximum = 10 ** length;
  return String(randomInt(minimum, maximum));
};

const hashPassword = async (password, salt = randomBytes(16).toString("hex")) => {
  const derivedKey = await scryptAsync(password, salt, 64);
  return {
    salt,
    hash: Buffer.from(derivedKey).toString("hex")
  };
};

const verifyPassword = async (password, passwordHash, salt) => {
  const derivedKey = await scryptAsync(password, salt, 64);
  const storedHash = Buffer.from(passwordHash, "hex");
  const candidateHash = Buffer.from(derivedKey);

  return storedHash.length === candidateHash.length && timingSafeEqual(storedHash, candidateHash);
};

module.exports = {
  createId,
  createNumericCode,
  createToken,
  hashPassword,
  hashValue,
  verifyPassword
};
