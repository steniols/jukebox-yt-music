const crypto = require("crypto");
const router = require("express").Router();
const queries = require("../../config/queries/queriesAuth");
const google = require("../services/googleClient");
const { encrypt } = require("../services/tokenCipher");
const {
  SESSION_COOKIE,
  cookieOptions,
  sessionCookieOptions,
  sha256,
  expiresAt,
  withAccessToken,
  requireSession,
  handleHostError,
} = require("../services/hostAuth");

const STATE_COOKIE = "google_oauth_state";
const STATE_COOKIE_PATH = "/api/youtube";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function statesMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function redirectWithLoginError(res, code) {
  res.redirect(`/?login_error=${encodeURIComponent(code)}`);
}

router.get("/login", (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOptions(STATE_COOKIE_PATH, STATE_MAX_AGE_MS));
  res.redirect(google.buildAuthorizeUrl(state));
});

router.get("/callback", async (req, res) => {
  const { code, error, state } = req.query;
  const expectedState = req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions(STATE_COOKIE_PATH));

  // O state vem primeiro: nada da resposta é confiável sem ele.
  if (!statesMatch(state, expectedState)) {
    return redirectWithLoginError(res, "invalid_state");
  }
  if (error) {
    return redirectWithLoginError(
      res,
      error === "access_denied" ? "access_denied" : "google_error"
    );
  }
  if (typeof code !== "string" || !code) {
    return redirectWithLoginError(res, "google_error");
  }

  try {
    const tokens = await google.exchangeCode(code);
    if (!google.hasYoutubeScope(tokens)) {
      return redirectWithLoginError(res, "missing_scope");
    }
    if (!tokens.refresh_token) {
      console.error("Falha no login com o Google: refresh token ausente");
      return redirectWithLoginError(res, "google_error");
    }

    const profile = await google.getUserInfo(tokens.access_token);
    const auth = await queries.saveAuth({
      username: profile.sub,
      token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt(tokens.expires_in),
    });

    const sessionId = crypto.randomBytes(32).toString("hex");
    await queries.createSession({
      id_hash: sha256(sessionId),
      auth_id: auth.id,
      expires_at: new Date(Date.now() + SESSION_MAX_AGE_MS),
    });

    res.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions(SESSION_MAX_AGE_MS));
    res.redirect("/");
  } catch (loginError) {
    console.error("Falha no login com o Google:", loginError.message);
    redirectWithLoginError(res, "google_error");
  }
});

router.get("/me", requireSession, async (req, res, next) => {
  try {
    const profile = await withAccessToken(req.auth, google.getUserInfo);
    res.json({ data: { id: profile.sub, display_name: profile.name || "" } });
  } catch (error) {
    await handleHostError(error, req, res, next);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (sessionId) await queries.deleteSession(sha256(sessionId));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
