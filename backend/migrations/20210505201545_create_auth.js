exports.up = function (knex) {
  return knex.schema.createTable("auth", function (t) {
    t.increments("id").unsigned().primary();
    t.text("token").notNull();
    t.text("refresh_token").notNull();
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("auth");
};
