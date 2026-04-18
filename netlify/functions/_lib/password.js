const crypto = require("node:crypto");

const ITERATIONS = 100_000;
const KEY_LENGTH  = 32; // bytes → 64 hex chars
const SALT_LENGTH = 16; // bytes → 32 hex chars
const DIGEST      = "sha256";

function hashPassword(plaintext) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const hash = crypto.pbkdf2Sync(plaintext, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plaintext, stored) {
  if (!plaintext) return false;
  const parts = String(stored || "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [salt, expectedHash] = parts;
  const actualHash = crypto.pbkdf2Sync(plaintext, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual   = Buffer.from(actualHash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
