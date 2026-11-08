// Tabelas da jukebox. Os tokens passam a aceitar nulo para que as jukeboxes do
// dono continuem existindo quando a autorização dele for revogada.
exports.up = async function (knex) {
  await knex.schema.alterTable("auth", function (t) {
    t.setNullable("token");
    t.setNullable("refresh_token");
  });

  await knex.schema.createTable("jukeboxes", function (t) {
    t.increments("id");
    t.integer("auth_id")
      .notNull()
      .references("id")
      .inTable("auth")
      .onDelete("CASCADE")
      .index();
    t.text("title").notNull();
    t.text("youtube_playlist_id").notNull();
    t.text("share_token_hash").notNull().unique();
    t.text("share_token_encrypted").notNull();
    t.boolean("active").notNull().defaultTo(true);
    t.timestamp("created_at", { useTz: true }).notNull().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("tracks", function (t) {
    t.increments("id");
    t.integer("jukebox_id")
      .notNull()
      .references("id")
      .inTable("jukeboxes")
      .onDelete("CASCADE");
    t.text("video_id").notNull();
    t.text("title").notNull();
    t.text("channel").notNull();
    t.text("thumbnail_url");
    t.integer("duration_seconds").notNull();
    t.text("added_by");
    t.text("added_by_guest").notNull();
    t.text("youtube_item_id");
    t.text("status").notNull().defaultTo("queued");
    t.timestamp("created_at", { useTz: true }).notNull().defaultTo(knex.fn.now());
    t.index(["jukebox_id", "status"]);
  });

  // Uma música aparece só uma vez na fila, e só uma toca por vez.
  await knex.raw(
    "CREATE UNIQUE INDEX tracks_one_queued_per_video ON tracks (jukebox_id, video_id) WHERE status = 'queued'"
  );
  await knex.raw(
    "CREATE UNIQUE INDEX tracks_one_playing ON tracks (jukebox_id) WHERE status = 'playing'"
  );

  // A chave primária garante um voto por pessoa em cada rodada.
  await knex.schema.createTable("votes", function (t) {
    t.integer("jukebox_id")
      .notNull()
      .references("id")
      .inTable("jukeboxes")
      .onDelete("CASCADE");
    t.text("guest_hash").notNull();
    t.integer("track_id")
      .notNull()
      .references("id")
      .inTable("tracks")
      .onDelete("CASCADE")
      .index();
    t.primary(["jukebox_id", "guest_hash"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable("votes");
  await knex.schema.dropTable("tracks");
  await knex.schema.dropTable("jukeboxes");
  await knex("auth").whereNull("token").orWhereNull("refresh_token").del();
  await knex.schema.alterTable("auth", function (t) {
    t.dropNullable("token");
    t.dropNullable("refresh_token");
  });
};
