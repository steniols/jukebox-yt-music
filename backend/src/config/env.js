const path = require("path");

// Variáveis já definidas no ambiente têm prioridade sobre o arquivo .env.
require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
  quiet: true,
});

const REQUIRED = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY",
];

function assertRequiredEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Variáveis de ambiente ausentes: ${missing.join(", ")}. Veja o arquivo .env.sample.`
    );
  }
}

module.exports = { assertRequiredEnv };
