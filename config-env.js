const fs = require("fs");
const path = require("path");

const stripQuotes = (value) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const parseEnvContent = (content) =>
  content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((accumulator, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = stripQuotes(line.slice(separatorIndex + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});

const loadEnvFiles = (rootDir, filenames = [".env", ".env.local"]) => {
  const externalEnvKeys = new Set(Object.keys(process.env));

  filenames.forEach((filename) => {
    const fullPath = path.join(rootDir, filename);
    if (!fs.existsSync(fullPath)) {
      return;
    }

    const parsed = parseEnvContent(fs.readFileSync(fullPath, "utf8"));
    Object.entries(parsed).forEach(([key, value]) => {
      if (externalEnvKeys.has(key)) {
        return;
      }

      process.env[key] = value;
    });
  });
};

module.exports = {
  loadEnvFiles,
  parseEnvContent
};
