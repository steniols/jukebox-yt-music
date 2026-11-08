const crypto = require("crypto");
const queries = require("../../config/queries/queriesAuth");
const google = require("./googleClient");
const { TokenDecryptError, encrypt, decrypt } = require("./tokenCipher");

const SESSION_COOKIE = "session";
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
const SIGNUP_REQUIRED = "youtubeSignupRequired";
const QUOTA_REASONS = ["quotaExceeded", "rateLimitExceeded", "dailyLimitExceeded"];
const INSUFFICIENT_SCOPE_REASONS = [
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
];

// O dono da jukebox não tem mais uma autorização válida no Google.
class HostAuthMissingError extends Error {
  constructor() {
    super("O dono não tem autorização válida no Google.");
    this.name = "HostAuthMissingError";
  }
}

// Evita renovar o mesmo token duas vezes quando há requisições simultâneas.
const refreshesInProgress = new Map();

function cookieOptions(path, maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path,
    ...(maxAge ? { maxAge } : {}),
  };
}

const sessionCookieOptions = (maxAge) => cookieOptions("/api", maxAge);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const expiresAt = (expiresInSeconds) =>
  new Date(Date.now() + expiresInSeconds * 1000);

function refreshAuth(auth) {
  if (refreshesInProgress.has(auth.id)) {
    return refreshesInProgress.get(auth.id);
  }

  const refresh = (async () => {
    const tokens = await google.refreshAccessToken(decrypt(auth.refresh_token));
    const changes = {
      token: encrypt(tokens.access_token),
      expires_at: expiresAt(tokens.expires_in),
    };
    // O Google só envia um novo refresh token quando decide trocá-lo.
    if (tokens.refresh_token) {
      changes.refresh_token = encrypt(tokens.refresh_token);
    }
    return queries.updateAuth(auth.id, changes);
  })().finally(() => refreshesInProgress.delete(auth.id));

  refreshesInProgress.set(auth.id, refresh);
  return refresh;
}

// Executa uma chamada ao Google garantindo um token de acesso válido.
async function withAccessToken(auth, call) {
  if (!auth || !auth.token || !auth.refresh_token) {
    throw new HostAuthMissingError();
  }

  const isExpiring =
    new Date(auth.expires_at).getTime() - TOKEN_EXPIRY_MARGIN_MS <= Date.now();
  const current = isExpiring ? await refreshAuth(auth) : auth;

  try {
    return await call(decrypt(current.token));
  } catch (error) {
    const isTokenRejected =
      error instanceof google.GoogleError &&
      error.status === 401 &&
      error.reason !== SIGNUP_REQUIRED;
    if (!isTokenRejected) throw error;

    // O token pode ter sido invalidado antes do prazo: renova e tenta uma vez.
    const refreshed = await refreshAuth(current);
    return call(decrypt(refreshed.token));
  }
}

// Autorização revogada ou tokens ilegíveis (a chave de criptografia mudou):
// não há como recuperar sem um novo login. invalid_client é erro de
// configuração do app, não do usuário.
function requiresNewLogin(error) {
  return (
    error instanceof HostAuthMissingError ||
    error instanceof TokenDecryptError ||
    (error instanceof google.GoogleError &&
      (error.reason === "invalid_grant" ||
        (error.status === 401 &&
          error.reason !== "invalid_client" &&
          error.reason !== SIGNUP_REQUIRED)))
  );
}

const isQuotaError = (error) =>
  error instanceof google.GoogleError && QUOTA_REASONS.includes(error.reason);

async function getSessionAuth(req) {
  const sessionId = req.cookies[SESSION_COOKIE];
  return sessionId ? queries.getAuthBySession(sha256(sessionId)) : null;
}

async function requireSession(req, res, next) {
  try {
    const auth = await getSessionAuth(req);
    if (!auth) {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return res.status(401).json({ error: "Sessão inválida ou expirada." });
    }
    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

// Erros de chamadas feitas pelo próprio dono, que está na sessão.
async function handleHostError(error, req, res, next) {
  try {
    if (requiresNewLogin(error)) {
      await queries.revokeAuth(req.auth.id);
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return res.status(401).json({ error: "Sessão inválida ou expirada." });
    }

    if (!(error instanceof google.GoogleError)) return next(error);

    console.error("Erro ao consultar o Google:", error.message);
    if (error.reason === SIGNUP_REQUIRED) {
      return res.status(409).json({
        error: "Crie um canal no YouTube para usar a jukebox.",
      });
    }
    if (isQuotaError(error)) {
      return res.status(503).json({
        error: "A cota diária da API do YouTube acabou. Tente novamente mais tarde.",
      });
    }
    if (INSUFFICIENT_SCOPE_REASONS.includes(error.reason)) {
      return res.status(403).json({
        error: "Faça login novamente e autorize o acesso ao YouTube.",
      });
    }
    res.status(502).json({ error: "YouTube indisponível." });
  } catch (cleanupError) {
    next(cleanupError);
  }
}

module.exports = {
  SESSION_COOKIE,
  cookieOptions,
  sessionCookieOptions,
  sha256,
  expiresAt,
  withAccessToken,
  requiresNewLogin,
  isQuotaError,
  getSessionAuth,
  requireSession,
  handleHostError,
};
