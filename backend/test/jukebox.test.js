process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.REDIRECT_URI = "http://127.0.0.1:4200/api/youtube/callback";
process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const request = require("supertest");
const { createMockGoogle } = require("./support/mock-google");
const app = require("../src/config/express");
const knex = require("../src/config/queries/knex");
const { parseVideoId, parsePlaylistId } = require("../src/app/services/videoUrl");

const HOST = { sub: "dono", name: "Dono" };
const OTHER = { sub: "outro", name: "Outro" };
const AUTH = "/api/youtube";
const JUKEBOXES = "/api/jukeboxes";

let mock;
let mockServer;

const videoId = (n) => `video${String(n).padStart(6, "0")}`;
const videoUrl = (n) => `https://music.youtube.com/watch?v=${videoId(n)}&si=abc`;

async function login(user = HOST) {
  const agent = request.agent(app);
  const start = await agent.get(`${AUTH}/login`).expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  await agent
    .get(`${AUTH}/callback`)
    .query({ code: mock.issueCode(user), state })
    .expect(302);
  return agent;
}

async function createRoom(agent, title = "Festa") {
  const res = await agent.post(JUKEBOXES).send({ title }).expect(201);
  const jukebox = res.body.data;
  return { jukebox, room: `/api/rooms/${jukebox.shareToken}` };
}

async function setup() {
  const host = await login();
  const { jukebox, room } = await createRoom(host);
  return { host, jukebox, room, guest: request.agent(app) };
}

async function add(agent, room, n, extra = {}) {
  const res = await agent
    .post(`${room}/tracks`)
    .send({ url: videoUrl(n), ...extra })
    .expect(201);
  return res.body.data;
}

const titles = (state) => state.queue.map((track) => track.videoId);
const trackFor = (state, n) => state.queue.find((t) => t.videoId === videoId(n));

// Evita que os limites por minuto interfiram em testes de outros assuntos.
const ageTracks = () =>
  knex("tracks").update({ created_at: new Date(Date.now() - 120000) });

before(async () => {
  mock = createMockGoogle({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  await new Promise((resolve) => {
    mockServer = mock.app.listen(0, "127.0.0.1", resolve);
  });
  process.env.GOOGLE_MOCK_URL = `http://127.0.0.1:${mockServer.address().port}`;
});

beforeEach(async () => {
  await knex("auth").del();
  mock.reset();
});

after(async () => {
  await knex.destroy();
  await new Promise((resolve) => mockServer.close(resolve));
});

// Links aceitos

test("reconhece links do YouTube e do YouTube Music", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&si=abc&list=PL123`,
    `https://m.youtube.com/watch?t=10&v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `  https://www.youtube.com/embed/${id}  `,
  ]) {
    assert.equal(parseVideoId(input), id, input);
  }
});

test("recusa links de outros sites ou malformados", () => {
  for (const input of [
    "",
    null,
    42,
    "curto",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=curto",
    "https://www.youtube.com/playlist?list=PL123",
    "javascript:alert(1)",
  ]) {
    assert.equal(parseVideoId(input), null, String(input));
  }
});

// Gestão pelo dono

test("criar jukebox cria uma playlist não listada no YouTube do dono", async () => {
  const host = await login();

  const { jukebox } = await createRoom(host, "  Churrasco  ");

  assert.equal(jukebox.title, "Churrasco");
  assert.equal(jukebox.active, true);
  assert.match(jukebox.shareToken, /^[0-9a-f]{64}$/);
  const playlist = mock.getPlaylist(jukebox.youtubePlaylistId);
  assert.equal(playlist.owner, "dono");
  assert.equal(playlist.snippet.title, "Churrasco");
  assert.equal(playlist.status.privacyStatus, "unlisted");
});

test("o link não fica legível no banco", async () => {
  const host = await login();
  const { jukebox } = await createRoom(host);

  const [row] = await knex("jukeboxes");

  assert.notEqual(row.share_token_hash, jukebox.shareToken);
  assert.ok(!row.share_token_encrypted.includes(jukebox.shareToken));
});

test("criar jukebox exige login e nome", async () => {
  await request(app).post(JUKEBOXES).send({ title: "x" }).expect(401);
  await request(app).get(JUKEBOXES).expect(401);

  const host = await login();
  await host.post(JUKEBOXES).send({ title: "   " }).expect(400);
  await host.post(JUKEBOXES).send({ title: "a".repeat(151) }).expect(400);
  await host.post(JUKEBOXES).send({ title: "ok", privacyStatus: "x" }).expect(400);
  assert.equal((await knex("jukeboxes")).length, 0);
});

test("conta sem canal recebe aviso e mantém a sessão", async () => {
  mock.usersWithoutChannel.add(HOST.sub);
  const host = await login();

  const res = await host.post(JUKEBOXES).send({ title: "Festa" }).expect(409);

  assert.match(res.body.error, /canal/i);
  await host.get(`${AUTH}/me`).expect(200);
});

test("cota esgotada ao criar responde 503 e não cria a jukebox", async () => {
  const host = await login();
  mock.apiFailure = { status: 403, reason: "quotaExceeded" };

  const res = await host.post(JUKEBOXES).send({ title: "Festa" }).expect(503);

  assert.match(res.body.error, /cota/i);
  assert.equal((await knex("jukeboxes")).length, 0);
});

test("o dono só vê e altera as próprias jukeboxes", async () => {
  const { host, jukebox } = await setup();
  const other = await login(OTHER);

  assert.equal((await other.get(JUKEBOXES).expect(200)).body.data.length, 0);
  await other.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: false }).expect(404);
  await other.post(`${JUKEBOXES}/${jukebox.id}/link`).expect(404);
  await other.delete(`${JUKEBOXES}/${jukebox.id}`).expect(404);

  const list = await host.get(JUKEBOXES).expect(200);
  assert.equal(list.body.data[0].id, jukebox.id);
  assert.equal(list.body.data[0].active, true);
});

test("a lista mostra quantas músicas aguardam", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  await add(guest, room, 2);

  const list = await host.get(JUKEBOXES).expect(200);

  assert.equal(list.body.data[0].queuedCount, 2);
});

// O link

test("link inexistente ou malformado responde 404 e avisa que a sala fechou", async () => {
  for (const path of [`/api/rooms/${"0".repeat(64)}`, "/api/rooms/nao-e-um-token"]) {
    const res = await request(app).get(path).expect(404);
    assert.equal(res.body.code, "room_closed");
  }
});

test("erros sobre uma música não são confundidos com a sala fechada", async () => {
  const { host, jukebox, room, guest } = await setup();
  mock.missingVideos.add(videoId(1));

  const responses = [
    await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(404),
    await guest.put(`${room}/vote`).send({ trackId: 999999 }).expect(404),
    await host.delete(`${room}/tracks/999999`).expect(404),
    await host.post(`${room}/import`).send({ url: "https://www.youtube.com/playlist?list=PLx" }).expect(404),
  ];
  for (const res of responses) assert.equal(res.body.code, undefined);

  await host.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: false }).expect(200);
  const closed = await guest.get(room).expect(410);
  assert.equal(closed.body.code, "room_closed");
});

test("quem tem o link entra sem login, e o estado não expõe segredos", async () => {
  const { room } = await setup();

  const res = await request(app).get(room).expect(200);

  assert.equal(res.body.data.title, "Festa");
  assert.equal(res.body.data.isHost, false);
  assert.equal(res.body.data.nowPlaying, null);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("share"));
  assert.ok(!text.includes("guest"));
  const cookie = res.headers["set-cookie"].find((c) => c.startsWith("guest_id="));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test("o dono é reconhecido no link", async () => {
  const { host, jukebox, room, guest } = await setup();

  const res = await host.get(room).expect(200);
  assert.equal(res.body.data.isHost, true);
  assert.equal(res.body.data.id, jukebox.id);

  const asGuest = await guest.get(room).expect(200);
  assert.equal(asGuest.body.data.isHost, false);
  assert.equal(asGuest.body.data.id, undefined);
});

test("link encerrado bloqueia convidados; reativar libera", async () => {
  const { host, jukebox, room, guest } = await setup();
  await host.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: false }).expect(200);

  await guest.get(room).expect(410);
  await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(410);
  await guest.put(`${room}/vote`).send({ trackId: 1 }).expect(410);
  const asHost = await host.get(room).expect(200);
  assert.equal(asHost.body.data.active, false);

  await host.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: true }).expect(200);
  await guest.get(room).expect(200);
});

test("gerar novo link invalida o anterior na hora", async () => {
  const { host, jukebox, room, guest } = await setup();

  const res = await host.post(`${JUKEBOXES}/${jukebox.id}/link`).expect(200);

  assert.notEqual(res.body.data.shareToken, jukebox.shareToken);
  await guest.get(room).expect(404);
  await guest.get(`/api/rooms/${res.body.data.shareToken}`).expect(200);
});

test("excluir a jukebox encerra o link e mantém a playlist no YouTube", async () => {
  const { host, jukebox, room, guest } = await setup();

  await host.delete(`${JUKEBOXES}/${jukebox.id}`).expect(204);

  await guest.get(room).expect(404);
  assert.ok(mock.getPlaylist(jukebox.youtubePlaylistId));
});

// Adicionar músicas

test("convidado adiciona música, que também vai para a playlist", async () => {
  const { jukebox, room, guest } = await setup();

  const state = await add(guest, room, 1, { addedBy: "  Ana  " });

  const [track] = state.queue;
  assert.equal(track.videoId, videoId(1));
  assert.equal(track.title, `Música ${videoId(1)}`);
  assert.equal(track.channel, "Canal Simulado");
  assert.equal(track.durationSeconds, 210);
  assert.equal(track.addedBy, "Ana");
  assert.equal(track.votes, 0);
  assert.equal(mock.itemsOf(jukebox.youtubePlaylistId).length, 1);
});

test("link inválido é recusado sem gastar cota", async () => {
  const { room, guest } = await setup();

  await guest.post(`${room}/tracks`).send({ url: "https://evil.com/x" }).expect(400);
  await guest.post(`${room}/tracks`).send({}).expect(400);

  assert.equal(mock.stats.videoLookups, 0);
});

test("música repetida na fila é recusada sem gastar cota", async () => {
  const { room, guest } = await setup();
  await add(guest, room, 1);
  const lookups = mock.stats.videoLookups;

  await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(409);

  assert.equal(mock.stats.videoLookups, lookups);
});

test("música que já tocou pode voltar para a fila", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  await host.post(`${room}/advance`).send({ fromTrackId: null }).expect(200);

  await add(guest, room, 1);
});

test("vídeo inexistente responde 404", async () => {
  const { room, guest } = await setup();
  mock.missingVideos.add(videoId(1));

  await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(404);
});

test("vídeo que não toca fora do YouTube é recusado", async () => {
  const { room, guest } = await setup();
  mock.overrideVideo(videoId(1), { status: { embeddable: false } });
  mock.overrideVideo(videoId(2), { snippet: { liveBroadcastContent: "live" } });
  mock.overrideVideo(videoId(3), {
    contentDetails: { contentRating: { ytRating: "ytAgeRestricted" } },
  });

  for (const n of [1, 2, 3]) {
    await guest.post(`${room}/tracks`).send({ url: videoUrl(n) }).expect(422);
  }
  assert.equal((await knex("tracks")).length, 0);
});

test("limita as adições por pessoa e protege a cota do dono", async () => {
  const { room, guest } = await setup();
  for (let n = 1; n <= 5; n += 1) await add(guest, room, n);
  const lookups = mock.stats.videoLookups;

  await guest.post(`${room}/tracks`).send({ url: videoUrl(6) }).expect(429);

  assert.equal(mock.stats.videoLookups, lookups);
  await add(request.agent(app), room, 6);
});

test("limita as adições da jukebox inteira, mesmo limpando cookies", async () => {
  const { room } = await setup();
  for (let n = 1; n <= 20; n += 1) await add(request.agent(app), room, n);

  await request(app).post(`${room}/tracks`).send({ url: videoUrl(21) }).expect(429);
});

test("a fila tem tamanho máximo", async () => {
  const { room, guest } = await setup();
  const [{ id: jukeboxId }] = await knex("jukeboxes");
  await knex("tracks").insert(
    Array.from({ length: 100 }, (_, i) => ({
      jukebox_id: jukeboxId,
      video_id: `seed${String(i).padStart(7, "0")}`,
      title: "x",
      channel: "x",
      duration_seconds: 1,
      added_by_guest: "x",
      created_at: new Date(Date.now() - 120000),
    }))
  );

  await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(409);
});

test("sem cota na playlist, a música entra na fila mesmo assim", async () => {
  const { jukebox, room, guest } = await setup();
  mock.playlistItemsFailure = { status: 403, reason: "quotaExceeded" };

  const state = await add(guest, room, 1);

  assert.equal(state.queue.length, 1);
  assert.equal(mock.itemsOf(jukebox.youtubePlaylistId).length, 0);
});

test("sem cota nenhuma, o convidado recebe uma mensagem clara", async () => {
  const { room, guest } = await setup();
  mock.apiFailure = { status: 403, reason: "quotaExceeded" };

  const res = await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(503);

  assert.match(res.body.error, /cota/i);
});

test("convidados continuam adicionando depois do logout do dono", async () => {
  const { host, room, guest } = await setup();

  await host.post(`${AUTH}/logout`).expect(204);

  await add(guest, room, 1);
});

test("autorização revogada mantém a jukebox e avisa o convidado", async () => {
  const { room, guest } = await setup();
  mock.revokeAccessTokens();
  mock.revokeRefreshTokens();

  const res = await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(503);

  assert.match(res.body.error, /dono/i);
  await guest.get(room).expect(200);
  const [auth] = await knex("auth");
  assert.equal(auth.token, null);
  assert.equal(auth.refresh_token, null);
});

// Importar playlist

const SOURCE = "PLfonte123";
const sourceUrl = `https://music.youtube.com/playlist?list=${SOURCE}`;
const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => videoId(from + i));

test("reconhece links de playlist", () => {
  for (const input of [
    sourceUrl,
    `https://www.youtube.com/playlist?list=${SOURCE}&si=x`,
    `https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=${SOURCE}`,
    `  https://m.youtube.com/playlist?list=${SOURCE}  `,
  ]) {
    assert.equal(parsePlaylistId(input), SOURCE, input);
  }
  for (const input of [
    null,
    "PLfonte123",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    `https://evil.com/playlist?list=${SOURCE}`,
    `https://youtu.be/dQw4w9WgXcQ?list=${SOURCE}`,
    "https://www.youtube.com/playlist?list=a&b",
    "https://www.youtube.com/playlist?list=<script>",
  ]) {
    assert.equal(parsePlaylistId(input), null, String(input));
  }
});

test("o dono importa uma playlist na ordem original, sem copiar para o YouTube", async () => {
  const { host, jukebox, room } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 3));

  const res = await host.post(`${room}/import`).send({ url: sourceUrl }).expect(200);

  assert.deepEqual(titles(res.body.data), range(1, 3));
  assert.equal(res.body.data.queue[0].addedBy, null);
  assert.deepEqual(res.body.summary, {
    added: 3,
    duplicates: 0,
    overLimit: 0,
    total: 3,
    unavailable: 0,
  });
  assert.equal(mock.stats.itemLists, 1);
  assert.equal(mock.stats.videoLookups, 1);
  assert.equal(mock.stats.itemInserts, 0);
  assert.equal(mock.itemsOf(jukebox.youtubePlaylistId).length, 0);
});

test("somente o dono importa", async () => {
  const { room, guest } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 3));
  const other = await login(OTHER);

  await guest.post(`${room}/import`).send({ url: sourceUrl }).expect(403);
  await other.post(`${room}/import`).send({ url: sourceUrl }).expect(403);

  assert.equal(mock.stats.itemLists, 0);
  assert.equal((await knex("tracks")).length, 0);
});

test("link inválido é recusado sem gastar cota", async () => {
  const { host, room } = await setup();

  await host.post(`${room}/import`).send({ url: videoUrl(1).split("&")[0] }).expect(400);
  await host.post(`${room}/import`).send({}).expect(400);

  assert.equal(mock.stats.itemLists, 0);
});

test("link encerrado não aceita importação", async () => {
  const { host, jukebox, room } = await setup();
  await host.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: false }).expect(200);

  await host.post(`${room}/import`).send({ url: sourceUrl }).expect(410);
});

test("importa só as primeiras 50 e informa o total", async () => {
  const { host, room } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 80));

  const res = await host.post(`${room}/import`).send({ url: sourceUrl }).expect(200);

  assert.equal(res.body.summary.added, 50);
  assert.equal(res.body.summary.total, 80);
  assert.equal(res.body.data.queue.length, 50);
});

test("ignora músicas repetidas e as que não tocam", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  mock.addSourcePlaylist(SOURCE, [
    ...range(1, 5),
    videoId(2), // repetida dentro da própria playlist
  ]);
  mock.missingVideos.add(videoId(3));
  mock.overrideVideo(videoId(4), { status: { embeddable: false } });

  const res = await host.post(`${room}/import`).send({ url: sourceUrl }).expect(200);

  assert.deepEqual(titles(res.body.data), [videoId(1), videoId(2), videoId(5)]);
  assert.equal(res.body.summary.added, 2);
  assert.equal(res.body.summary.duplicates, 1);
  assert.equal(res.body.summary.unavailable, 2);
});

test("respeita o tamanho máximo da fila", async () => {
  const { host, room } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 50));
  mock.addSourcePlaylist("PLoutra", range(101, 150));
  mock.addSourcePlaylist("PLterceira", range(201, 210));
  const url = (id) => `https://www.youtube.com/playlist?list=${id}`;
  await host.post(`${room}/import`).send({ url: sourceUrl }).expect(200);
  await host.post(`${room}/import`).send({ url: url("PLoutra") }).expect(200);
  const lists = mock.stats.itemLists;

  await host.post(`${room}/import`).send({ url: url("PLterceira") }).expect(409);
  assert.equal(mock.stats.itemLists, lists);

  await host.delete(`${room}/tracks/${(await knex("tracks").first()).id}`).expect(200);
  const res = await host.post(`${room}/import`).send({ url: url("PLterceira") }).expect(200);
  assert.equal(res.body.summary.added, 1);
  assert.equal(res.body.summary.overLimit, 9);
  assert.equal(res.body.data.queue.length, 100);
});

test("importar não bloqueia os convidados de adicionar músicas", async () => {
  const { host, room, guest } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 50));

  await host.post(`${room}/import`).send({ url: sourceUrl }).expect(200);

  await add(guest, room, 51);
});

test("músicas importadas recebem votos e tocam normalmente", async () => {
  const { host, room, guest } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 2));
  const imported = (await host.post(`${room}/import`).send({ url: sourceUrl })).body.data;

  await guest.put(`${room}/vote`).send({ trackId: trackFor(imported, 2).id }).expect(200);
  const res = await host.post(`${room}/advance`).send({ fromTrackId: null }).expect(200);

  assert.equal(res.body.data.nowPlaying.videoId, videoId(2));
});

test("remover música importada não tenta alterar o YouTube", async () => {
  const { host, room } = await setup();
  mock.addSourcePlaylist(SOURCE, range(1, 1));
  const imported = (await host.post(`${room}/import`).send({ url: sourceUrl })).body.data;

  await host.delete(`${room}/tracks/${imported.queue[0].id}`).expect(200);

  assert.equal(mock.stats.itemDeletes, 0);
});

test("playlist inacessível responde com mensagem clara e mantém a sessão", async () => {
  const { host, room } = await setup();
  mock.failSourcePlaylist("PLprivada", 403, "playlistItemsNotAccessible");
  mock.failSourcePlaylist("WL", 403, "watchLaterNotAccessible");
  mock.failSourcePlaylist("RDmix", 400, "playlistOperationUnsupported");
  const url = (id) => `https://www.youtube.com/playlist?list=${id}`;

  await host.post(`${room}/import`).send({ url: url("PLnaoexiste") }).expect(404);
  for (const id of ["PLprivada", "WL", "RDmix"]) {
    await host.post(`${room}/import`).send({ url: url(id) }).expect(422);
  }

  await host.get(`${AUTH}/me`).expect(200);
});

test("cota esgotada ao importar responde 503", async () => {
  const { host, room } = await setup();
  mock.apiFailure = { status: 403, reason: "quotaExceeded" };

  const res = await host.post(`${room}/import`).send({ url: sourceUrl }).expect(503);

  assert.match(res.body.error, /cota/i);
});

test("as jukeboxes voltam a funcionar quando o dono entra de novo", async () => {
  const { room, guest } = await setup();
  mock.revokeAccessTokens();
  mock.revokeRefreshTokens();
  await guest.post(`${room}/tracks`).send({ url: videoUrl(1) }).expect(503);

  await login();

  await add(guest, room, 1);
});

test("logout sem jukeboxes ativas descarta os tokens", async () => {
  const { host, jukebox } = await setup();
  await host.patch(`${JUKEBOXES}/${jukebox.id}`).send({ active: false }).expect(200);

  await host.post(`${AUTH}/logout`).expect(204);

  const [auth] = await knex("auth");
  assert.equal(auth.token, null);
  assert.equal((await knex("jukeboxes")).length, 1);
});

// Votação

test("a música mais votada fica no topo; empate respeita a ordem de chegada", async () => {
  const { room, guest } = await setup();
  await add(guest, room, 1);
  await add(guest, room, 2);
  const state = await add(guest, room, 3);
  assert.deepEqual(titles(state), [videoId(1), videoId(2), videoId(3)]);

  const voted = await guest
    .put(`${room}/vote`)
    .send({ trackId: trackFor(state, 3).id })
    .expect(200);

  assert.deepEqual(titles(voted.body.data), [videoId(3), videoId(1), videoId(2)]);
  assert.equal(trackFor(voted.body.data, 3).votes, 1);
  assert.equal(trackFor(voted.body.data, 3).votedByMe, true);
});

test("cada pessoa tem um voto: votar de novo move o voto", async () => {
  const { room, guest } = await setup();
  await add(guest, room, 1);
  const state = await add(guest, room, 2);

  await guest.put(`${room}/vote`).send({ trackId: trackFor(state, 1).id }).expect(200);
  await guest.put(`${room}/vote`).send({ trackId: trackFor(state, 1).id }).expect(200);
  const moved = await guest
    .put(`${room}/vote`)
    .send({ trackId: trackFor(state, 2).id })
    .expect(200);

  assert.equal(trackFor(moved.body.data, 1).votes, 0);
  assert.equal(trackFor(moved.body.data, 2).votes, 1);
  assert.equal((await knex("votes")).length, 1);
});

test("os votos de pessoas diferentes somam, e cada uma vê apenas o próprio", async () => {
  const { room, guest } = await setup();
  const state = await add(guest, room, 1);
  const track = trackFor(state, 1);
  const friend = request.agent(app);

  await guest.put(`${room}/vote`).send({ trackId: track.id }).expect(200);
  const res = await friend.put(`${room}/vote`).send({ trackId: track.id }).expect(200);
  assert.equal(trackFor(res.body.data, 1).votes, 2);

  await friend.delete(`${room}/vote`).expect(200);
  const seenByFriend = (await friend.get(room).expect(200)).body.data;
  assert.equal(trackFor(seenByFriend, 1).votes, 1);
  assert.equal(trackFor(seenByFriend, 1).votedByMe, false);
  const seenByGuest = (await guest.get(room).expect(200)).body.data;
  assert.equal(trackFor(seenByGuest, 1).votedByMe, true);
});

test("não dá para votar em música de outra jukebox ou fora da fila", async () => {
  const { host, room, guest } = await setup();
  const state = await add(guest, room, 1);
  const { room: otherRoom } = await createRoom(host, "Outra");

  await guest.put(`${otherRoom}/vote`).send({ trackId: state.queue[0].id }).expect(404);
  await guest.put(`${room}/vote`).send({ trackId: 999999 }).expect(404);
  await guest.put(`${room}/vote`).send({ trackId: "abc" }).expect(400);
  await guest.put(`${room}/vote`).send({}).expect(400);
});

// Reprodução

test("somente o dono controla a reprodução e remove músicas", async () => {
  const { room, guest } = await setup();
  const state = await add(guest, room, 1);

  await guest.post(`${room}/advance`).send({ fromTrackId: null }).expect(403);
  await guest.delete(`${room}/tracks/${state.queue[0].id}`).expect(403);
  await (await login(OTHER)).post(`${room}/advance`).send({ fromTrackId: null }).expect(403);

  assert.equal((await knex("tracks").where("status", "queued")).length, 1);
});

test("avançar toca a mais votada e abre uma nova rodada de votos", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  const state = await add(guest, room, 2);
  await guest.put(`${room}/vote`).send({ trackId: trackFor(state, 2).id }).expect(200);

  const first = await host.post(`${room}/advance`).send({ fromTrackId: null }).expect(200);

  assert.equal(first.body.data.nowPlaying.videoId, videoId(2));
  assert.deepEqual(titles(first.body.data), [videoId(1)]);
  assert.equal(first.body.data.queue[0].votes, 0);
  assert.equal((await knex("votes")).length, 0);

  const second = await host
    .post(`${room}/advance`)
    .send({ fromTrackId: first.body.data.nowPlaying.id })
    .expect(200);
  assert.equal(second.body.data.nowPlaying.videoId, videoId(1));

  const third = await host
    .post(`${room}/advance`)
    .send({ fromTrackId: second.body.data.nowPlaying.id })
    .expect(200);
  assert.equal(third.body.data.nowPlaying, null);
  assert.equal(third.body.data.queue.length, 0);
});

test("pedidos repetidos para a mesma faixa não pulam músicas", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  await add(guest, room, 2);
  await add(guest, room, 3);
  const first = await host.post(`${room}/advance`).send({ fromTrackId: null }).expect(200);
  const fromTrackId = first.body.data.nowPlaying.id;

  await Promise.all([
    host.post(`${room}/advance`).send({ fromTrackId }).expect(200),
    host.post(`${room}/advance`).send({ fromTrackId }).expect(200),
    host.post(`${room}/advance`).send({ fromTrackId }).expect(200),
  ]);

  const state = (await host.get(room).expect(200)).body.data;
  assert.equal(state.nowPlaying.videoId, videoId(2));
  assert.deepEqual(titles(state), [videoId(3)]);
});

test("o dono remove uma música da fila e da playlist", async () => {
  const { host, jukebox, room, guest } = await setup();
  const state = await add(guest, room, 1);
  await guest.put(`${room}/vote`).send({ trackId: state.queue[0].id }).expect(200);

  const res = await host.delete(`${room}/tracks/${state.queue[0].id}`).expect(200);

  assert.equal(res.body.data.queue.length, 0);
  assert.equal(mock.itemsOf(jukebox.youtubePlaylistId).length, 0);
  assert.equal((await knex("votes")).length, 0);
});

test("falha ao remover da playlist não impede tirar a música da fila", async () => {
  const { host, room, guest } = await setup();
  const state = await add(guest, room, 1);
  mock.playlistItemsFailure = { status: 500, reason: "backendError" };

  const res = await host.delete(`${room}/tracks/${state.queue[0].id}`).expect(200);

  assert.equal(res.body.data.queue.length, 0);
});

test("o estado de uma jukebox não vaza para outra", async () => {
  const { host, room, guest } = await setup();
  await add(guest, room, 1);
  await ageTracks();

  const { room: otherRoom } = await createRoom(host, "Outra");

  const other = (await guest.get(otherRoom).expect(200)).body.data;
  assert.equal(other.title, "Outra");
  assert.equal(other.queue.length, 0);
});
