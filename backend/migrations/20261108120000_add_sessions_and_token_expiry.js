// Os tokens antigos estavam em texto puro e sem data de expiração, então são
// descartados: cada usuário só precisa fazer login novamente.
exports.up = async function (knex) {
  await knex("auth").del();

  await knex.schema.alterTable("auth", function (t) {
    t.timestamp("expires_at", { useTz: true }).notNull();
    t.unique(["username"]);
  });

  await knex.schema.createTable("sessions", function (t) {
    t.text("id_hash").primary();
    t.integer("auth_id")
      .notNull()
      .references("id")
      .inTable("auth")
      .onDelete("CASCADE");
    t.timestamp("expires_at", { useTz: true }).notNull().index();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable("sessions");
  await knex("auth").del();
  await knex.schema.alterTable("auth", function (t) {
    t.dropUnique(["username"]);
    t.dropColumn("expires_at");
  });
};
