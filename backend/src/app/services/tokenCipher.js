const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

class TokenDecryptError extends Error {
  constructor() {
    super("Não foi possível descriptografar o token.");
    this.name = "TokenDecryptError";
  }
}

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ter 32 bytes em hexadecimal.");
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plainText) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64"))
    .join(".");
}

function decrypt(stored) {
  const key = getKey();
  try {
    const [iv, authTag, encrypted] = stored
      .split(".")
      .map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenDecryptError();
  }
}

module.exports = { TokenDecryptError, encrypt, decrypt, getKey };
