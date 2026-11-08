const knex = require("./knex");

// Sem sessões, o token só é mantido se houver jukebox ativa: os convidados
// dependem dele para adicionar músicas enquanto o dono está fora.
async function releaseTokens(trx, authId, { keepForActive }) {
  const jukeboxes = await trx("jukeboxes").where("auth_id", authId);
  if (!jukeboxes.length) {
    return trx("auth").where("id", authId).del();
  }
  if (keepForActive && jukeboxes.some((jukebox) => jukebox.active)) return;
  return trx("auth")
    .where("id", authId)
    .update({ token: null, refresh_token: null });
}

module.exports = {
  async saveAuth(data) {
    const [auth] = await knex("auth")
      .insert(data)
      .onConflict("username")
      .merge()
      .returning("*");
    return auth;
  },

  async getAuth(id) {
    return knex("auth").where({ id }).first();
  },

  async updateAuth(id, data) {
    const [auth] = await knex("auth").where({ id }).update(data).returning("*");
    return auth;
  },

  // Autorização perdida: encerra as sessões e descarta os tokens, sem apagar
  // as jukeboxes, que voltam a funcionar quando o dono entrar de novo.
  async revokeAuth(id) {
    return knex.transaction(async (trx) => {
      await trx("sessions").where("auth_id", id).del();
      await releaseTokens(trx, id, { keepForActive: false });
    });
  },

  async createSession(session) {
    await knex("sessions").where("expires_at", "<=", new Date()).del();
    return knex("sessions").insert(session);
  },

  async getAuthBySession(idHash) {
    return knex("sessions")
      .join("auth", "sessions.auth_id", "auth.id")
      .where("sessions.id_hash", idHash)
      .where("sessions.expires_at", ">", new Date())
      .first("auth.*");
  },

  async deleteSession(idHash) {
    return knex.transaction(async (trx) => {
      const session = await trx("sessions").where("id_hash", idHash).first();
      if (!session) return;

      await trx("sessions").where("id_hash", idHash).del();
      const remaining = await trx("sessions")
        .where("auth_id", session.auth_id)
        .first();
      if (!remaining) {
        await releaseTokens(trx, session.auth_id, { keepForActive: true });
      }
    });
  },
};
