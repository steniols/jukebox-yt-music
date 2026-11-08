const DEFAULT_ACCOUNTS_URL = "https://accounts.spotify.com";
const DEFAULT_API_URL = "https://api.spotify.com";
const REQUEST_TIMEOUT_MS = 10000;

// /me retorna id e display_name; o escopo mantém o app com o mínimo de acesso.
const SCOPES = ["user-read-private"];

class SpotifyError extends Error {
  constructor(status, code) {
    super(`Spotify respondeu ${status}${code ? ` (${code})` : ""}`);
    this.name = "SpotifyError";
    this.status = status;
    this.code = code;
  }
}

// As URLs só podem ser trocadas (pelo simulador) fora de produção.
function baseUrl(envName, fallback) {
  if (process.env.NODE_ENV === "production") return fallback;
  return process.env[envName] || fallback;
}

const accountsUrl = () =>
  baseUrl("SPOTIFY_ACCOUNTS_URL", DEFAULT_ACCOUNTS_URL);
const apiUrl = () => baseUrl("SPOTIFY_API_URL", DEFAULT_API_URL);

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
  });
  return `${accountsUrl()}/authorize?${params}`;
}

// Falhas de rede e timeouts viram SpotifyError, como as respostas de erro.
async function send(url, options) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SpotifyError(503, "unavailable");
  }
}

async function requestToken(params) {
  const credentials = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString("base64");

  const response = await send(`${accountsUrl()}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new SpotifyError(response.status, body.error);
  return body;
}

function exchangeCode(code) {
  return requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.REDIRECT_URI,
  });
}

function refreshAccessToken(refreshToken) {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function getMe(accessToken) {
  const response = await send(`${apiUrl()}/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new SpotifyError(response.status);
  return response.json();
}

module.exports = {
  SpotifyError,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  getMe,
};
