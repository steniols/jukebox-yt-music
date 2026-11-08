const knex = require("./knex");

const UNIQUE_VIOLATION = "23505";

// Mais votadas primeiro; no empate, quem foi adicionada antes.
const QUEUE_ORDER = "count(votes.track_id) DESC, tracks.created_at ASC, tracks.id ASC";

function queuedTracks(db, jukeboxId) {
  return db("tracks")
    .where({ "tracks.jukebox_id": jukeboxId, "tracks.status": "queued" })
    .leftJoin("votes", "votes.track_id", "tracks.id")
    .groupBy("tracks.id")
    .orderByRaw(QUEUE_ORDER);
}

module.exports = {
  async listByOwner(authId) {
    return knex("jukeboxes")
      .where("jukeboxes.auth_id", authId)
      .leftJoin("tracks", function () {
        this.on("tracks.jukebox_id", "jukeboxes.id").andOnVal(
          "tracks.status",
          "queued"
        );
      })
      .groupBy("jukeboxes.id")
      .orderBy("jukeboxes.created_at", "desc")
      .select("jukeboxes.*", knex.raw("count(tracks.id)::int as queued_count"));
  },

  async create(data) {
    const [jukebox] = await knex("jukeboxes").insert(data).returning("*");
    return jukebox;
  },

  async getOwned(id, authId) {
    return knex("jukeboxes").where({ id, auth_id: authId }).first();
  },

  async getByTokenHash(hash) {
    return knex("jukeboxes").where("share_token_hash", hash).first();
  },

  async update(id, changes) {
    const [jukebox] = await knex("jukeboxes")
      .where({ id })
      .update(changes)
      .returning("*");
    return jukebox;
  },

  async remove(id) {
    return knex("jukeboxes").where({ id }).del();
  },

  async getNowPlaying(jukeboxId) {
    return knex("tracks")
      .where({ jukebox_id: jukeboxId, status: "playing" })
      .first();
  },

  async getQueue(jukeboxId) {
    return queuedTracks(knex, jukeboxId).select(
      "tracks.*",
      knex.raw("count(votes.track_id)::int as votes")
    );
  },

  async getGuestVote(jukeboxId, guestHash) {
    const vote = await knex("votes")
      .where({ jukebox_id: jukeboxId, guest_hash: guestHash })
      .first();
    return vote ? vote.track_id : null;
  },

  async countQueued(jukeboxId) {
    const { count } = await knex("tracks")
      .where({ jukebox_id: jukeboxId, status: "queued" })
      .count({ count: "*" })
      .first();
    return Number(count);
  },

  async isQueued(jukeboxId, videoId) {
    const track = await knex("tracks")
      .where({ jukebox_id: jukeboxId, video_id: videoId, status: "queued" })
      .first();
    return Boolean(track);
  },

  async countRecentAdds(jukeboxId, windowMs, guestHash) {
    const query = knex("tracks")
      .where({ jukebox_id: jukeboxId, imported: false })
      .where("created_at", ">", new Date(Date.now() - windowMs));
    if (guestHash) query.where("added_by_guest", guestHash);
    const { count } = await query.count({ count: "*" }).first();
    return Number(count);
  },

  // Retorna null se a mesma música entrou na fila ao mesmo tempo.
  async addTrack(data) {
    try {
      const [track] = await knex("tracks").insert(data).returning("*");
      return track;
    } catch (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  },

  // Adiciona o que couber na fila, na ordem recebida, ignorando as repetidas.
  async importTracks(jukeboxId, guestHash, videos, maxQueueSize) {
    return knex.transaction(async (trx) => {
      await trx("jukeboxes").where("id", jukeboxId).forUpdate().first();

      const queued = await trx("tracks")
        .where({ jukebox_id: jukeboxId, status: "queued" })
        .select("video_id");
      const queuedIds = new Set(queued.map((track) => track.video_id));

      const fresh = videos.filter((video) => !queuedIds.has(video.id));
      const room = Math.max(maxQueueSize - queued.length, 0);
      const accepted = fresh.slice(0, room);

      if (accepted.length) {
        await trx("tracks").insert(
          accepted.map((video) => ({
            jukebox_id: jukeboxId,
            video_id: video.id,
            title: video.title,
            channel: video.channel,
            thumbnail_url: video.thumbnailUrl,
            duration_seconds: video.durationSeconds,
            added_by_guest: guestHash,
            imported: true,
          }))
        );
      }

      return {
        added: accepted.length,
        duplicates: videos.length - fresh.length,
        overLimit: fresh.length - accepted.length,
      };
    });
  },

  async setYoutubeItem(trackId, itemId) {
    return knex("tracks").where("id", trackId).update({ youtube_item_id: itemId });
  },

  async getQueuedTrack(jukeboxId, trackId) {
    return knex("tracks")
      .where({ id: trackId, jukebox_id: jukeboxId, status: "queued" })
      .first();
  },

  async removeTrack(id) {
    return knex("tracks").where({ id }).del();
  },

  async setVote(jukeboxId, guestHash, trackId) {
    return knex("votes")
      .insert({ jukebox_id: jukeboxId, guest_hash: guestHash, track_id: trackId })
      .onConflict(["jukebox_id", "guest_hash"])
      .merge(["track_id"]);
  },

  async clearVote(jukeboxId, guestHash) {
    return knex("votes")
      .where({ jukebox_id: jukeboxId, guest_hash: guestHash })
      .del();
  },

  // Passa para a próxima música e abre uma nova rodada de votos. fromTrackId
  // evita pular duas músicas quando chegam dois pedidos pela mesma faixa.
  async advance(jukeboxId, fromTrackId) {
    return knex.transaction(async (trx) => {
      await trx("jukeboxes").where("id", jukeboxId).forUpdate().first();

      const current = await trx("tracks")
        .where({ jukebox_id: jukeboxId, status: "playing" })
        .first();
      if ((current ? current.id : null) !== fromTrackId) return false;

      if (current) {
        await trx("tracks").where("id", current.id).update({ status: "played" });
      }

      const next = await queuedTracks(trx, jukeboxId).first("tracks.id");
      if (next) {
        await trx("tracks").where("id", next.id).update({ status: "playing" });
      }
      await trx("votes").where("jukebox_id", jukeboxId).del();
      return true;
    });
  },
};
