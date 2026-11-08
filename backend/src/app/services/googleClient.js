const ENDPOINTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  playlists: "https://www.googleapis.com/youtube/v3/playlists",
  playlistItems: "https://www.googleapis.com/youtube/v3/playlistItems",
  videos: "https://www.googleapis.com/youtube/v3/videos",
};
const REQUEST_TIMEOUT_MS = 10000;
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
const SCOPES = ["openid", "profile", YOUTUBE_SCOPE];

class GoogleError extends Error {
  constructor(status, reason) {
    super(`Google respondeu ${status}${reason ? ` (${reason})` : ""}`);
    this.name = "GoogleError";
    this.status = status;
    this.reason = reason;
  }
}

// O simulador só existe nos testes automatizados.
function endpoint(name) {
  const url = ENDPOINTS[name];
  const mockUrl = process.env.GOOGLE_MOCK_URL;
  if (process.env.NODE_ENV !== "test" || !mockUrl) return url;
  return `${mockUrl}${new URL(url).pathname}`;
}

// Falhas de rede e timeouts viram GoogleError, como as respostas de erro.
async function send(url, options) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleError(503, "unavailable");
  }
}

// O OAuth responde { error: "motivo" }; a API responde { error: { errors: [{ reason }] } }.
function errorReason(body) {
  if (typeof body.error === "string") return body.error;
  return body.error && body.error.errors && body.error.errors[0]
    ? body.error.errors[0].reason
    : undefined;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleError(response.status, errorReason(body));
  return body;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
    // Sem estes dois parâmetros, o Google pode não devolver o refresh token.
    access_type: "offline",
    prompt: "consent",
  });
  return `${endpoint("authorize")}?${params}`;
}

async function requestToken(params) {
  const response = await send(endpoint("token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  return parseResponse(response);
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

// O usuário pode desmarcar permissões na tela de consentimento do Google.
function hasYoutubeScope(tokens) {
  return (tokens.scope || "").split(" ").includes(YOUTUBE_SCOPE);
}

async function getUserInfo(accessToken) {
  const response = await send(endpoint("userinfo"), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseResponse(response);
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function createPlaylist(accessToken, { title, description, privacyStatus }) {
  const params = new URLSearchParams({ part: "snippet,status" });
  const response = await send(`${endpoint("playlists")}?${params}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus },
    }),
  });
  return parseResponse(response);
}

// Converte durações como PT1H2M3S em segundos.
function parseDuration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!match) return 0;
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

// Ao vivo e com restrição de idade não tocam no player incorporado.
function isPlayable({ snippet, status, contentDetails }) {
  const rating = (contentDetails && contentDetails.contentRating) || {};
  return (
    Boolean(status && status.embeddable) &&
    (status.privacyStatus === undefined || status.privacyStatus !== "private") &&
    snippet.liveBroadcastContent === "none" &&
    rating.ytRating !== "ytAgeRestricted"
  );
}

function presentVideo(video) {
  const thumbnails = video.snippet.thumbnails || {};
  const thumbnail = thumbnails.medium || thumbnails.default;
  return {
    id: video.id,
    title: video.snippet.title,
    // Canais gerados pelo YouTube Music têm o sufixo " - Topic".
    channel: (video.snippet.channelTitle || "").replace(/ - Topic$/, ""),
    thumbnailUrl: thumbnail ? thumbnail.url : null,
    durationSeconds: parseDuration(
      video.contentDetails && video.contentDetails.duration
    ),
    playable: isPlayable(video),
  };
}

// Até 50 vídeos por chamada, na mesma ordem pedida. Vídeos excluídos ou
// privados não voltam na resposta.
async function getVideos(accessToken, videoIds) {
  if (!videoIds.length) return [];
  const params = new URLSearchParams({
    part: "snippet,status,contentDetails",
    id: videoIds.join(","),
    maxResults: "50",
  });
  const response = await send(`${endpoint("videos")}?${params}`, {
    headers: authHeaders(accessToken),
  });
  const body = await parseResponse(response);
  const byId = new Map((body.items || []).map((video) => [video.id, video]));
  return videoIds
    .filter((id) => byId.has(id))
    .map((id) => presentVideo(byId.get(id)));
}

// Retorna null quando o vídeo não existe.
async function getVideo(accessToken, videoId) {
  const [video] = await getVideos(accessToken, [videoId]);
  return video || null;
}

// Lê a primeira página da playlist, com até 50 músicas.
async function listPlaylistVideoIds(accessToken, playlistId) {
  const params = new URLSearchParams({
    part: "snippet",
    playlistId,
    maxResults: "50",
  });
  const response = await send(`${endpoint("playlistItems")}?${params}`, {
    headers: authHeaders(accessToken),
  });
  const body = await parseResponse(response);
  const ids = (body.items || [])
    .map((item) => item.snippet?.resourceId?.videoId)
    .filter(Boolean);
  return {
    videoIds: [...new Set(ids)],
    total: body.pageInfo?.totalResults ?? ids.length,
  };
}

async function insertPlaylistItem(accessToken, playlistId, videoId) {
  const params = new URLSearchParams({ part: "snippet" });
  const response = await send(`${endpoint("playlistItems")}?${params}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    }),
  });
  const body = await parseResponse(response);
  return body.id;
}

async function deletePlaylistItem(accessToken, itemId) {
  const params = new URLSearchParams({ id: itemId });
  const response = await send(`${endpoint("playlistItems")}?${params}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) await parseResponse(response);
}

module.exports = {
  GoogleError,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  hasYoutubeScope,
  getUserInfo,
  createPlaylist,
  getVideo,
  getVideos,
  listPlaylistVideoIds,
  insertPlaylistItem,
  deletePlaylistItem,
};
