const crypto = require("crypto");
const express = require("express");
const authQueries = require("../../config/queries/queriesAuth");
const queries = require("../../config/queries/queriesJukebox");
const google = require("../services/googleClient");
const { parseVideoId, parsePlaylistId } = require("../services/videoUrl");
const {
  TokenDecryptError,
  encrypt,
  decrypt,
} = require("../services/tokenCipher");
const {
  cookieOptions,
  sha256,
  withAccessToken,
  requiresNewLogin,
  isQuotaError,
  getSessionAuth,
  requireSession,
  handleHostError,
} = require("../services/hostAuth");

const GUEST_COOKIE = "guest_id";
const GUEST_COOKIE_PATH = "/api/rooms";
const GUEST_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[1-9]\d{0,8}$/;
const MAX_TITLE_LENGTH = 150;
const MAX_NAME_LENGTH = 40;
const PRIVACY_OPTIONS = ["public", "private", "unlisted"];

// Cada música adicionada gasta 51 unidades da cota diária do dono (10.000).
const MAX_QUEUE_SIZE = 100;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_ADDS_PER_GUEST = 5;
const MAX_ADDS_PER_JUKEBOX = 20;
// Distingue "a sala fechou" de um 404 sobre uma música ou playlist.
const ROOM_CLOSED = "room_closed";
const PLAYLIST_READ_REASONS = [
  "playlistItemsNotAccessible",
  "watchHistoryNotAccessible",
  "watchLaterNotAccessible",
  "playlistOperationUnsupported",
];

function newShareTokenColumns() {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    share_token_hash: sha256(token),
    share_token_encrypted: encrypt(token),
  };
}

function readShareToken(jukebox) {
  try {
    return decrypt(jukebox.share_token_encrypted);
  } catch (error) {
    if (error instanceof TokenDecryptError) return null;
    throw error;
  }
}

function presentJukebox(jukebox) {
  return {
    id: jukebox.id,
    title: jukebox.title,
    active: jukebox.active,
    youtubePlaylistId: jukebox.youtube_playlist_id,
    queuedCount: jukebox.queued_count || 0,
    shareToken: readShareToken(jukebox),
  };
}

function presentTrack(track, myVote) {
  return {
    id: track.id,
    videoId: track.video_id,
    title: track.title,
    channel: track.channel,
    thumbnailUrl: track.thumbnail_url,
    durationSeconds: track.duration_seconds,
    addedBy: track.added_by,
    ...(track.status === "queued"
      ? { votes: track.votes, votedByMe: track.id === myVote }
      : {}),
  };
}

async function presentRoom(req) {
  const { jukebox, guestHash } = req;
  const [nowPlaying, queue, myVote] = await Promise.all([
    queries.getNowPlaying(jukebox.id),
    queries.getQueue(jukebox.id),
    queries.getGuestVote(jukebox.id, guestHash),
  ]);
  return {
    ...(req.isHost ? { id: jukebox.id } : {}),
    title: jukebox.title,
    active: jukebox.active,
    isHost: req.isHost,
    nowPlaying: nowPlaying ? presentTrack(nowPlaying) : null,
    queue: queue.map((track) => presentTrack(track, myVote)),
  };
}

// Erros ao usar a conta do dono em nome de um convidado. A sessão de quem fez
// o pedido não é afetada.
async function handleGuestError(error, req, res, next) {
  try {
    if (requiresNewLogin(error)) {
      await authQueries.revokeAuth(req.jukebox.auth_id);
      return res.status(503).json({
        error: "O dono da jukebox precisa entrar novamente para aceitar músicas.",
      });
    }
    if (isQuotaError(error)) {
      return res.status(503).json({
        error: "A cota diária do YouTube acabou. Tente novamente mais tarde.",
      });
    }
    if (error instanceof google.GoogleError) {
      console.error("Erro ao consultar o Google:", error.message);
      return res.status(502).json({ error: "YouTube indisponível." });
    }
    next(error);
  } catch (cleanupError) {
    next(cleanupError);
  }
}

// Espelhar no YouTube não pode travar a festa: a fila continua sem isso.
async function bestEffort(description, task) {
  try {
    return await task();
  } catch (error) {
    console.error(`Falha ao ${description}:`, error.message);
    return null;
  }
}

// Rotas do dono: /api/jukeboxes

const jukeboxes = express.Router();
jukeboxes.use(requireSession);

async function loadOwned(req, res, next) {
  try {
    const jukebox = ID_PATTERN.test(req.params.id)
      ? await queries.getOwned(req.params.id, req.auth.id)
      : null;
    if (!jukebox) {
      return res.status(404).json({ error: "Jukebox não encontrada." });
    }
    req.jukebox = jukebox;
    next();
  } catch (error) {
    next(error);
  }
}

jukeboxes.get("/", async (req, res, next) => {
  try {
    const rows = await queries.listByOwner(req.auth.id);
    res.json({ data: rows.map(presentJukebox) });
  } catch (error) {
    next(error);
  }
});

jukeboxes.post("/", async (req, res, next) => {
  const { title, privacyStatus = "unlisted" } = req.body || {};
  const trimmed = typeof title === "string" ? title.trim() : "";

  if (!trimmed) return res.status(400).json({ error: "Informe o nome da jukebox." });
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return res
      .status(400)
      .json({ error: `O nome aceita até ${MAX_TITLE_LENGTH} caracteres.` });
  }
  if (!PRIVACY_OPTIONS.includes(privacyStatus)) {
    return res.status(400).json({ error: "Privacidade inválida." });
  }

  try {
    const playlist = await withAccessToken(req.auth, (token) =>
      google.createPlaylist(token, {
        title: trimmed,
        description: "Criada pela jukebox colaborativa",
        privacyStatus,
      })
    );
    const jukebox = await queries.create({
      auth_id: req.auth.id,
      title: trimmed,
      youtube_playlist_id: playlist.id,
      ...newShareTokenColumns(),
    });
    res.status(201).json({ data: presentJukebox(jukebox) });
  } catch (error) {
    await handleHostError(error, req, res, next);
  }
});

jukeboxes.patch("/:id", loadOwned, async (req, res, next) => {
  if (typeof (req.body || {}).active !== "boolean") {
    return res.status(400).json({ error: "Informe se o link está ativo." });
  }
  try {
    const jukebox = await queries.update(req.jukebox.id, {
      active: req.body.active,
    });
    res.json({ data: presentJukebox(jukebox) });
  } catch (error) {
    next(error);
  }
});

// O link anterior deixa de funcionar imediatamente.
jukeboxes.post("/:id/link", loadOwned, async (req, res, next) => {
  try {
    const jukebox = await queries.update(req.jukebox.id, newShareTokenColumns());
    res.json({ data: presentJukebox(jukebox) });
  } catch (error) {
    next(error);
  }
});

// A playlist continua na conta do YouTube; só a jukebox é removida.
jukeboxes.delete("/:id", loadOwned, async (req, res, next) => {
  try {
    await queries.remove(req.jukebox.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Rotas de quem tem o link: /api/rooms/:token

const rooms = express.Router({ mergeParams: true });

async function loadRoom(req, res, next) {
  try {
    const jukebox = TOKEN_PATTERN.test(req.params.token)
      ? await queries.getByTokenHash(sha256(req.params.token))
      : null;
    if (!jukebox) {
      return res
        .status(404)
        .json({ error: "Este link não existe mais.", code: ROOM_CLOSED });
    }

    const sessionAuth = await getSessionAuth(req);
    req.jukebox = jukebox;
    req.isHost = Boolean(sessionAuth) && sessionAuth.id === jukebox.auth_id;

    if (!jukebox.active && !req.isHost) {
      return res
        .status(410)
        .json({ error: "O dono encerrou este link.", code: ROOM_CLOSED });
    }

    let guestId = req.cookies[GUEST_COOKIE];
    if (typeof guestId !== "string" || !TOKEN_PATTERN.test(guestId)) {
      guestId = crypto.randomBytes(32).toString("hex");
    }
    // Renovar a cada visita mantém o voto de quem continua participando.
    res.cookie(
      GUEST_COOKIE,
      guestId,
      cookieOptions(GUEST_COOKIE_PATH, GUEST_MAX_AGE_MS)
    );
    req.guestHash = sha256(`${jukebox.id}:${guestId}`);
    next();
  } catch (error) {
    next(error);
  }
}

function requireActive(req, res, next) {
  if (!req.jukebox.active) {
    return res.status(410).json({ error: "Este link está encerrado." });
  }
  next();
}

function requireHost(req, res, next) {
  if (!req.isHost) {
    return res.status(403).json({ error: "Somente o dono pode fazer isso." });
  }
  next();
}

function parseTrackId(value) {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && ID_PATTERN.test(text) ? Number(text) : null;
}

rooms.use(loadRoom);

rooms.get("/", async (req, res, next) => {
  try {
    res.json({ data: await presentRoom(req) });
  } catch (error) {
    next(error);
  }
});

rooms.post("/tracks", requireActive, async (req, res, next) => {
  const { jukebox, guestHash } = req;
  const { url, addedBy } = req.body || {};
  const videoId = parseVideoId(url);
  if (!videoId) {
    return res
      .status(400)
      .json({ error: "Cole um link válido do YouTube ou do YouTube Music." });
  }

  const name =
    typeof addedBy === "string" ? addedBy.trim().slice(0, MAX_NAME_LENGTH) : "";

  try {
    // Estas verificações vêm antes do Google para não gastar a cota do dono.
    const [guestAdds, roomAdds, queued, alreadyQueued] = await Promise.all([
      queries.countRecentAdds(jukebox.id, RATE_WINDOW_MS, guestHash),
      queries.countRecentAdds(jukebox.id, RATE_WINDOW_MS),
      queries.countQueued(jukebox.id),
      queries.isQueued(jukebox.id, videoId),
    ]);

    if (guestAdds >= MAX_ADDS_PER_GUEST || roomAdds >= MAX_ADDS_PER_JUKEBOX) {
      return res
        .status(429)
        .json({ error: "Muitas músicas de uma vez. Aguarde um minuto." });
    }
    if (alreadyQueued) {
      return res.status(409).json({ error: "Essa música já está na fila." });
    }
    if (queued >= MAX_QUEUE_SIZE) {
      return res.status(409).json({ error: "A fila está cheia." });
    }

    const auth = await authQueries.getAuth(jukebox.auth_id);
    const video = await withAccessToken(auth, (token) =>
      google.getVideo(token, videoId)
    );
    if (!video) {
      return res.status(404).json({ error: "Música não encontrada." });
    }
    if (!video.playable) {
      return res
        .status(422)
        .json({ error: "Essa música não pode ser tocada fora do YouTube." });
    }

    const track = await queries.addTrack({
      jukebox_id: jukebox.id,
      video_id: video.id,
      title: video.title,
      channel: video.channel,
      thumbnail_url: video.thumbnailUrl,
      duration_seconds: video.durationSeconds,
      added_by: name || null,
      added_by_guest: guestHash,
    });
    if (!track) {
      return res.status(409).json({ error: "Essa música já está na fila." });
    }

    const itemId = await bestEffort("adicionar à playlist do YouTube", () =>
      withAccessToken(auth, (token) =>
        google.insertPlaylistItem(token, jukebox.youtube_playlist_id, video.id)
      )
    );
    if (itemId) await queries.setYoutubeItem(track.id, itemId);

    res.status(201).json({ data: await presentRoom(req) });
  } catch (error) {
    await handleGuestError(error, req, res, next);
  }
});

// Respostas do Google específicas de ler uma playlist.
function playlistReadError(error) {
  if (!(error instanceof google.GoogleError)) return null;
  if (error.status === 404) {
    return { status: 404, message: "Playlist não encontrada ou sem acesso." };
  }
  if (
    PLAYLIST_READ_REASONS.includes(error.reason) ||
    error.status === 400
  ) {
    return { status: 422, message: "Essa playlist não pode ser importada." };
  }
  return null;
}

// Só o dono importa. Para poupar a cota, as músicas ficam apenas na fila, sem
// serem copiadas para a playlist do YouTube da jukebox.
rooms.post("/import", requireHost, requireActive, async (req, res, next) => {
  const { jukebox, guestHash } = req;
  const playlistId = parsePlaylistId((req.body || {}).url);
  if (!playlistId) {
    return res.status(400).json({
      error: "Cole o link de uma playlist do YouTube ou do YouTube Music.",
    });
  }

  try {
    req.auth = await authQueries.getAuth(jukebox.auth_id);

    // Sem espaço na fila, não há por que gastar a cota.
    if ((await queries.countQueued(jukebox.id)) >= MAX_QUEUE_SIZE) {
      return res.status(409).json({ error: "A fila está cheia." });
    }

    const { videoIds, total } = await withAccessToken(req.auth, (token) =>
      google.listPlaylistVideoIds(token, playlistId)
    );
    const videos = await withAccessToken(req.auth, (token) =>
      google.getVideos(token, videoIds)
    );
    const playable = videos.filter((video) => video.playable);

    const result = await queries.importTracks(
      jukebox.id,
      guestHash,
      playable,
      MAX_QUEUE_SIZE
    );

    res.json({
      data: await presentRoom(req),
      summary: {
        ...result,
        total,
        unavailable: videoIds.length - playable.length,
      },
    });
  } catch (error) {
    const readError = playlistReadError(error);
    if (readError) {
      return res.status(readError.status).json({ error: readError.message });
    }
    await handleHostError(error, req, res, next);
  }
});

// Cada pessoa tem um voto por rodada: votar em outra música move o voto.
rooms.put("/vote", requireActive, async (req, res, next) => {
  const trackId = parseTrackId((req.body || {}).trackId);
  if (!trackId) return res.status(400).json({ error: "Música inválida." });

  try {
    const track = await queries.getQueuedTrack(req.jukebox.id, trackId);
    if (!track) {
      return res.status(404).json({ error: "Essa música não está mais na fila." });
    }
    await queries.setVote(req.jukebox.id, req.guestHash, trackId);
    res.json({ data: await presentRoom(req) });
  } catch (error) {
    next(error);
  }
});

rooms.delete("/vote", requireActive, async (req, res, next) => {
  try {
    await queries.clearVote(req.jukebox.id, req.guestHash);
    res.json({ data: await presentRoom(req) });
  } catch (error) {
    next(error);
  }
});

rooms.post("/advance", requireHost, async (req, res, next) => {
  const { fromTrackId } = req.body || {};
  const from = fromTrackId === null ? null : parseTrackId(fromTrackId);
  if (from === null && fromTrackId !== null) {
    return res.status(400).json({ error: "Música inválida." });
  }

  try {
    await queries.advance(req.jukebox.id, from);
    res.json({ data: await presentRoom(req) });
  } catch (error) {
    next(error);
  }
});

rooms.delete("/tracks/:trackId", requireHost, async (req, res, next) => {
  const trackId = parseTrackId(req.params.trackId);
  try {
    const track = trackId
      ? await queries.getQueuedTrack(req.jukebox.id, trackId)
      : null;
    if (!track) {
      return res.status(404).json({ error: "Essa música não está mais na fila." });
    }
    await queries.removeTrack(track.id);

    if (track.youtube_item_id) {
      const auth = await authQueries.getAuth(req.jukebox.auth_id);
      await bestEffort("remover da playlist do YouTube", () =>
        withAccessToken(auth, (token) =>
          google.deletePlaylistItem(token, track.youtube_item_id)
        )
      );
    }
    res.json({ data: await presentRoom(req) });
  } catch (error) {
    next(error);
  }
});

module.exports = { jukeboxes, rooms };
