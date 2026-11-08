// Músicas importadas pelo dono não contam nos limites por minuto dos convidados.
exports.up = function (knex) {
  return knex.schema.alterTable("tracks", function (t) {
    t.boolean("imported").notNull().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("tracks", function (t) {
    t.dropColumn("imported");
  });
};
