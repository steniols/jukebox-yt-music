const knex = require("./knex");

module.exports = {
  async saveAuth(data) {
    const [auth] = await knex("auth")
      .insert(data)
      .onConflict("username")
      .merge()
      .returning("*");
    return auth;
  },

  async updateAuth(id, data) {
    const [auth] = await knex("auth").where({ id }).update(data).returning("*");
    return auth;
  },

  async deleteAuth(id) {
    return knex("auth").where({ id }).del();
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

  // Remove a sessão e, se era a última do usuário, também os tokens dele.
  async deleteSession(idHash) {
    return knex.transaction(async (trx) => {
      const session = await trx("sessions").where("id_hash", idHash).first();
      if (!session) return;

      await trx("sessions").where("id_hash", idHash).del();
      const remaining = await trx("sessions")
        .where("auth_id", session.auth_id)
        .first();
      if (!remaining) {
        await trx("auth").where("id", session.auth_id).del();
      }
    });
  },
};
