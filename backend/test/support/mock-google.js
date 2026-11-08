// Simulador do Google e do YouTube usado apenas pelos testes automatizados.
// Nunca conversa com o Google.
const crypto = require("crypto");
const express = require("express");

const DEFAULT_USER = { sub: "usuario-simulado", name: "Usuário Simulado" };
const FULL_SCOPE = "openid profile https://www.googleapis.com/auth/youtube";

function createMockGoogle({ clientId, clientSecret } = {}) {
  const codes = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();
  const playlists = new Map();
  const playlistItems = new Map();
  const videoOverrides = new Map();
  const sourcePlaylists = new Map();
  const sourcePlaylistFailures = new Map();
  const newToken = (prefix) =>
    `${prefix}-${crypto.randomBytes(16).toString("hex")}`;

  const apiError = (res, status, reason) =>
    res.status(status).json({
      error: { code: status, message: reason, errors: [{ reason }] },
    });

  const mock = {
    stats: {
      exchanges: 0,
      refreshes: 0,
      videoLookups: 0,
      itemLists: 0,
      itemInserts: 0,
      itemDeletes: 0,
    },
    apiFailure: null,
    playlistItemsFailure: null,
    rotateRefreshToken: false,
    usersWithoutChannel: new Set(),
    missingVideos: new Set(),

    issueCode(user = DEFAULT_USER, options = {}) {
      const code = newToken("code");
      codes.set(code, {
        user,
        scope: options.scope || FULL_SCOPE,
        withRefreshToken: options.withRefreshToken !== false,
      });
      return code;
    },
    revokeAccessTokens() {
      accessTokens.clear();
    },
    revokeRefreshTokens() {
      refreshTokens.clear();
    },
    overrideVideo(id, resource) {
      videoOverrides.set(id, resource);
    },
    addSourcePlaylist(id, videoIds) {
      sourcePlaylists.set(id, videoIds);
    },
    failSourcePlaylist(id, status, reason) {
      sourcePlaylistFailures.set(id, { status, reason });
    },
    getPlaylist(id) {
      return playlists.get(id);
    },
    itemsOf(playlistId) {
      return [...playlistItems.values()].filter(
        (item) => item.snippet.playlistId === playlistId
      );
    },
    reset() {
      playlists.clear();
      playlistItems.clear();
      videoOverrides.clear();
      sourcePlaylists.clear();
      sourcePlaylistFailures.clear();
      mock.apiFailure = null;
      mock.playlistItemsFailure = null;
      mock.rotateRefreshToken = false;
      mock.usersWithoutChannel.clear();
      mock.missingVideos.clear();
      for (const key of Object.keys(mock.stats)) mock.stats[key] = 0;
    },
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/o/oauth2/v2/auth", (req, res) => {
    const { client_id: id, redirect_uri: redirectUri, state, scope } = req.query;
    if (clientId && id !== clientId) {
      return res.status(400).send("client_id inválido");
    }
    const target = new URL(redirectUri);
    target.searchParams.set(
      "code",
      mock.issueCode(DEFAULT_USER, {
        scope,
        // Como no Google real: sem estes parâmetros não há refresh token.
        withRefreshToken:
          req.query.access_type === "offline" && req.query.prompt === "consent",
      })
    );
    target.searchParams.set("state", state);
    res.redirect(target.toString());
  });

  app.post("/token", (req, res) => {
    if (
      clientId &&
      (req.body.client_id !== clientId || req.body.client_secret !== clientSecret)
    ) {
      return res.status(401).json({ error: "invalid_client" });
    }

    let grant;
    const body = { token_type: "Bearer", expires_in: 3599 };

    if (req.body.grant_type === "authorization_code") {
      grant = codes.get(req.body.code);
      if (!grant) return res.status(400).json({ error: "invalid_grant" });
      codes.delete(req.body.code);
      mock.stats.exchanges += 1;
      if (grant.withRefreshToken) {
        body.refresh_token = newToken("refresh");
        refreshTokens.set(body.refresh_token, grant);
      }
    } else if (req.body.grant_type === "refresh_token") {
      grant = refreshTokens.get(req.body.refresh_token);
      if (!grant) return res.status(400).json({ error: "invalid_grant" });
      mock.stats.refreshes += 1;
      if (mock.rotateRefreshToken) {
        refreshTokens.delete(req.body.refresh_token);
        body.refresh_token = newToken("refresh");
        refreshTokens.set(body.refresh_token, grant);
      }
    } else {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }

    body.scope = grant.scope;
    body.access_token = newToken("access");
    accessTokens.set(body.access_token, grant.user);
    res.json(body);
  });

  function requireToken(req, res, next) {
    const token = (req.get("authorization") || "").replace(/^Bearer /, "");
    req.user = accessTokens.get(token);
    if (!req.user) return apiError(res, 401, "authError");
    next();
  }

  app.get("/v1/userinfo", requireToken, (req, res) => {
    res.json(req.user);
  });

  const youtube = express.Router();
  youtube.use(requireToken);
  youtube.use((req, res, next) => {
    if (mock.apiFailure) {
      return apiError(res, mock.apiFailure.status, mock.apiFailure.reason);
    }
    if (mock.usersWithoutChannel.has(req.user.sub)) {
      return apiError(res, 401, "youtubeSignupRequired");
    }
    next();
  });

  youtube.post("/playlists", (req, res) => {
    const { snippet = {}, status = {} } = req.body;
    if (!snippet.title) return apiError(res, 400, "playlistTitleRequired");
    const id = `PL${crypto.randomBytes(8).toString("hex")}`;
    const playlist = { id, owner: req.user.sub, snippet, status };
    playlists.set(id, playlist);
    res.json(playlist);
  });

  youtube.get("/videos", (req, res) => {
    mock.stats.videoLookups += 1;
    const ids = String(req.query.id).split(",");
    if (ids.length > 50) return apiError(res, 400, "invalidVideoId");
    const items = ids
      .filter((id) => !mock.missingVideos.has(id))
      .map((id) => {
        const resource = videoOverrides.get(id) || {};
        return {
          id,
          snippet: {
            title: `Música ${id}`,
            channelTitle: "Canal Simulado - Topic",
            liveBroadcastContent: "none",
            thumbnails: {
              medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
            },
            ...resource.snippet,
          },
          status: { embeddable: true, privacyStatus: "public", ...resource.status },
          contentDetails: { duration: "PT3M30S", ...resource.contentDetails },
        };
      });
    // Como na API real, a resposta não garante a ordem pedida.
    res.json({ items: items.reverse() });
  });

  youtube.get("/playlistItems", (req, res) => {
    mock.stats.itemLists += 1;
    const { playlistId, maxResults } = req.query;
    const failure = sourcePlaylistFailures.get(playlistId);
    if (failure) return apiError(res, failure.status, failure.reason);
    const videoIds = sourcePlaylists.get(playlistId);
    if (!videoIds) return apiError(res, 404, "playlistNotFound");
    res.json({
      pageInfo: { totalResults: videoIds.length },
      items: videoIds.slice(0, Number(maxResults) || 5).map((videoId) => ({
        snippet: { resourceId: { kind: "youtube#video", videoId } },
      })),
    });
  });

  function checkItemsFailure(req, res, next) {
    if (mock.playlistItemsFailure) {
      return apiError(
        res,
        mock.playlistItemsFailure.status,
        mock.playlistItemsFailure.reason
      );
    }
    next();
  }

  youtube.post("/playlistItems", checkItemsFailure, (req, res) => {
    const { snippet = {} } = req.body;
    const playlist = playlists.get(snippet.playlistId);
    if (!playlist) return apiError(res, 404, "playlistNotFound");
    if (playlist.owner !== req.user.sub) {
      return apiError(res, 403, "playlistItemsNotAccessible");
    }
    const item = { id: `UEx${crypto.randomBytes(8).toString("hex")}`, snippet };
    playlistItems.set(item.id, item);
    mock.stats.itemInserts += 1;
    res.json(item);
  });

  youtube.delete("/playlistItems", checkItemsFailure, (req, res) => {
    if (!playlistItems.delete(req.query.id)) {
      return apiError(res, 404, "playlistItemNotFound");
    }
    mock.stats.itemDeletes += 1;
    res.status(204).end();
  });

  app.use("/youtube/v3", youtube);

  mock.app = app;
  mock.defaultUser = DEFAULT_USER;
  return mock;
}

module.exports = { createMockGoogle, FULL_SCOPE };
