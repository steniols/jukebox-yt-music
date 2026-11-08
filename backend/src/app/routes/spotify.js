const crypto = require("crypto");
const router = require("express").Router();
const queries = require("../../config/queries/queriesSpotify");
const spotify = require("../services/spotifyClient");
const {
  TokenDecryptError,
  encrypt,
  decrypt,
} = require("../services/tokenCipher");

const STATE_COOKIE = "spotify_oauth_state";
const SESSION_COOKIE = "session";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

// Evita renovar o mesmo token duas vezes quando há requisições simultâneas.
const refreshesInProgress = new Map();

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/spotify",
    ...(maxAge ? { maxAge } : {}),
  };
}

const hashSessionId = (id) =>
  crypto.createHash("sha256").update(id).digest("hex");

const expiresAt = (expiresInSeconds) =>
  new Date(Date.now() + expiresInSeconds * 1000);

function statesMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function redirectWithLoginError(res, code) {
  res.redirect(`/?login_error=${encodeURIComponent(code)}`);
}

function refreshAuth(auth) {
  if (refreshesInProgress.has(auth.id)) {
    return refreshesInProgress.get(auth.id);
  }

  const refresh = (async () => {
    const tokens = await spotify.refreshAccessToken(decrypt(auth.refresh_token));
    const changes = {
      token: encrypt(tokens.access_token),
      expires_at: expiresAt(tokens.expires_in),
    };
    // O Spotify só envia um novo refresh token quando decide trocá-lo.
    if (tokens.refresh_token) {
      changes.refresh_token = encrypt(tokens.refresh_token);
    }
    return queries.updateAuth(auth.id, changes);
  })().finally(() => refreshesInProgress.delete(auth.id));

  refreshesInProgress.set(auth.id, refresh);
  return refresh;
}

async function getProfile(auth) {
  const isExpiring =
    new Date(auth.expires_at).getTime() - TOKEN_EXPIRY_MARGIN_MS <= Date.now();
  const current = isExpiring ? await refreshAuth(auth) : auth;

  try {
    return await spotify.getMe(decrypt(current.token));
  } catch (error) {
    if (error.status !== 401) throw error;
    // O token pode ter sido invalidado antes do prazo: renova e tenta uma vez.
    const refreshed = await refreshAuth(current);
    return spotify.getMe(decrypt(refreshed.token));
  }
}

async function requireSession(req, res, next) {
  try {
    const sessionId = req.cookies[SESSION_COOKIE];
    const auth = sessionId
      ? await queries.getAuthBySession(hashSessionId(sessionId))
      : null;

    if (!auth) {
      res.clearCookie(SESSION_COOKIE, cookieOptions());
      return res.status(401).json({ error: "Sessão inválida ou expirada" });
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

router.get("/login", (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOptions(STATE_MAX_AGE_MS));
  res.redirect(spotify.buildAuthorizeUrl(state));
});

router.get("/callback", async (req, res) => {
  const { code, error, state } = req.query;
  const expectedState = req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions());

  // O state vem primeiro: nada da resposta é confiável sem ele.
  if (!statesMatch(state, expectedState)) {
    return redirectWithLoginError(res, "invalid_state");
  }
  if (error) {
    return redirectWithLoginError(
      res,
      error === "access_denied" ? "access_denied" : "spotify_error"
    );
  }
  if (typeof code !== "string" || !code) {
    return redirectWithLoginError(res, "spotify_error");
  }

  try {
    const tokens = await spotify.exchangeCode(code);
    const profile = await spotify.getMe(tokens.access_token);
    const auth = await queries.saveAuth({
      username: profile.id,
      token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt(tokens.expires_in),
    });

    const sessionId = crypto.randomBytes(32).toString("hex");
    await queries.createSession({
      id_hash: hashSessionId(sessionId),
      auth_id: auth.id,
      expires_at: new Date(Date.now() + SESSION_MAX_AGE_MS),
    });

    res.cookie(SESSION_COOKIE, sessionId, cookieOptions(SESSION_MAX_AGE_MS));
    res.redirect("/");
  } catch (loginError) {
    console.error("Falha no login com o Spotify:", loginError.message);
    redirectWithLoginError(res, "spotify_error");
  }
});

router.get("/me", requireSession, async (req, res, next) => {
  try {
    const profile = await getProfile(req.auth);
    res.json({ data: { id: profile.id, display_name: profile.display_name } });
  } catch (error) {
    try {
      // Autorização revogada ou tokens ilegíveis (a chave de criptografia mudou):
      // não há como recuperar, então é preciso fazer login novamente.
      const mustLogin =
        error instanceof TokenDecryptError ||
        (error instanceof spotify.SpotifyError &&
          (error.code === "invalid_grant" || error.status === 401));

      if (mustLogin) {
        await queries.deleteAuth(req.auth.id);
        res.clearCookie(SESSION_COOKIE, cookieOptions());
        return res.status(401).json({ error: "Sessão inválida ou expirada" });
      }

      if (error instanceof spotify.SpotifyError) {
        console.error("Erro ao consultar o Spotify:", error.message);
        return res.status(502).json({ error: "Spotify indisponível" });
      }

      next(error);
    } catch (cleanupError) {
      next(cleanupError);
    }
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (sessionId) await queries.deleteSession(hashSessionId(sessionId));
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
