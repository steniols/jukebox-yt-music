process.env.NODE_ENV = "test";
process.env.CLIENT_ID = "test-client";
process.env.CLIENT_SECRET = "test-secret";
process.env.REDIRECT_URI = "http://127.0.0.1:4200/api/spotify/callback";
process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const request = require("supertest");
const { createMockSpotify } = require("../scripts/mock-spotify");
const app = require("../src/config/express");
const knex = require("../src/config/queries/knex");
const { decrypt } = require("../src/app/services/tokenCipher");

const ALICE = { id: "alice", display_name: "Alice" };
const BOB = { id: "bob", display_name: "Bob" };

let mock;
let mockServer;

async function login(user = ALICE) {
  const agent = request.agent(app);
  const start = await agent.get("/api/spotify/login").expect(302);
  const { state } = Object.fromEntries(
    new URL(start.headers.location).searchParams
  );
  const callback = await agent
    .get("/api/spotify/callback")
    .query({ code: mock.issueCode(user), state })
    .expect(302);
  return { agent, callback };
}

before(async () => {
  mock = createMockSpotify({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  });
  await new Promise((resolve) => {
    mockServer = mock.app.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${mockServer.address().port}`;
  process.env.SPOTIFY_ACCOUNTS_URL = url;
  process.env.SPOTIFY_API_URL = url;
});

beforeEach(async () => {
  await knex("sessions").del();
  await knex("auth").del();
  mock.failMe = false;
  mock.rotateRefreshToken = false;
  mock.expiresIn = 3600;
  mock.stats.exchanges = 0;
  mock.stats.refreshes = 0;
});

after(async () => {
  await knex.destroy();
  await new Promise((resolve) => mockServer.close(resolve));
});

test("/login envia ao Spotify um state que também fica em cookie httpOnly", async () => {
  const res = await request(app).get("/api/spotify/login").expect(302);
  const target = new URL(res.headers.location);

  assert.equal(target.pathname, "/authorize");
  assert.equal(target.searchParams.get("client_id"), "test-client");
  assert.equal(target.searchParams.get("scope"), "user-read-private");

  const cookie = res.headers["set-cookie"][0];
  assert.ok(cookie.includes(target.searchParams.get("state")));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test("callback com state ausente ou incorreto não troca o code nem cria sessão", async () => {
  const agent = request.agent(app);
  await agent.get("/api/spotify/login").expect(302);

  for (const query of [{}, { state: "errado" }]) {
    const res = await agent
      .get("/api/spotify/callback")
      .query({ ...query, code: mock.issueCode() })
      .expect(302);
    assert.equal(res.headers.location, "/?login_error=invalid_state");
  }

  assert.equal(mock.stats.exchanges, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("recusa do usuário no Spotify volta como login_error", async () => {
  const agent = request.agent(app);
  const start = await agent.get("/api/spotify/login");
  const state = new URL(start.headers.location).searchParams.get("state");

  const res = await agent
    .get("/api/spotify/callback")
    .query({ error: "access_denied", state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=access_denied");
});

test("code rejeitado pelo Spotify volta como login_error sem criar sessão", async () => {
  const agent = request.agent(app);
  const start = await agent.get("/api/spotify/login");
  const state = new URL(start.headers.location).searchParams.get("state");

  const res = await agent
    .get("/api/spotify/callback")
    .query({ code: "code-invalido", state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=spotify_error");
  assert.equal((await knex("sessions")).length, 0);
});

test("login completo cria sessão sem expor tokens ao navegador", async () => {
  const { agent, callback } = await login();

  assert.equal(callback.headers.location, "/");
  const session = callback.headers["set-cookie"].find((c) =>
    c.startsWith("session=")
  );
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);

  const me = await agent.get("/api/spotify/me").expect(200);
  assert.deepEqual(me.body, {
    data: { id: "alice", display_name: "Alice" },
  });
});

test("tokens e id de sessão não ficam legíveis no banco", async () => {
  const { callback } = await login();
  const [auth] = await knex("auth");
  const [session] = await knex("sessions");
  const sessionId = callback.headers["set-cookie"]
    .find((c) => c.startsWith("session="))
    .match(/^session=([^;]+)/)[1];

  assert.doesNotMatch(auth.token, /^access-/);
  assert.doesNotMatch(auth.refresh_token, /^refresh-/);
  assert.match(decrypt(auth.token), /^access-/);
  assert.match(decrypt(auth.refresh_token), /^refresh-/);
  assert.notEqual(session.id_hash, sessionId);
});

test("/me responde 401 sem cookie ou com sessão desconhecida", async () => {
  await request(app).get("/api/spotify/me").expect(401);
  await request(app)
    .get("/api/spotify/me")
    .set("Cookie", "session=nao-existe")
    .expect(401);
});

test("/me responde 401 quando a sessão expirou", async () => {
  const { agent } = await login();
  await knex("sessions").update({ expires_at: new Date(Date.now() - 1000) });
  await agent.get("/api/spotify/me").expect(401);
});

test("usuários simultâneos recebem somente os próprios dados", async () => {
  const [alice, bob] = await Promise.all([login(ALICE), login(BOB)]);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => {
      const isAlice = i % 2 === 0;
      return (isAlice ? alice : bob).agent
        .get("/api/spotify/me")
        .expect(200)
        .then((res) => [isAlice ? "alice" : "bob", res.body.data.id]);
    })
  );

  for (const [expected, received] of results) {
    assert.equal(received, expected);
  }
});

test("token vencido é renovado e salvo, sem renovar de novo", async () => {
  const { agent } = await login();
  await knex("auth").update({ expires_at: new Date(Date.now() - 1000) });
  const [before] = await knex("auth");

  await agent.get("/api/spotify/me").expect(200);
  await agent.get("/api/spotify/me").expect(200);

  const [saved] = await knex("auth");
  assert.equal(mock.stats.refreshes, 1);
  assert.notEqual(decrypt(saved.token), decrypt(before.token));
  assert.equal(decrypt(saved.refresh_token), decrypt(before.refresh_token));
  assert.ok(new Date(saved.expires_at) > new Date());
});

test("refresh token trocado pelo Spotify é salvo", async () => {
  mock.rotateRefreshToken = true;
  const { agent } = await login();
  await knex("auth").update({ expires_at: new Date(Date.now() - 1000) });
  const [before] = await knex("auth");

  await agent.get("/api/spotify/me").expect(200);

  const [saved] = await knex("auth");
  assert.notEqual(decrypt(saved.refresh_token), decrypt(before.refresh_token));
});

test("requisições simultâneas com token vencido renovam uma única vez", async () => {
  mock.rotateRefreshToken = true;
  const { agent } = await login();
  await knex("auth").update({ expires_at: new Date(Date.now() - 1000) });

  await Promise.all([
    agent.get("/api/spotify/me").expect(200),
    agent.get("/api/spotify/me").expect(200),
    agent.get("/api/spotify/me").expect(200),
  ]);

  assert.equal(mock.stats.refreshes, 1);
});

test("token invalidado antes do prazo é renovado automaticamente", async () => {
  const { agent } = await login();
  mock.revokeAccessTokens();

  await agent.get("/api/spotify/me").expect(200);

  assert.equal(mock.stats.refreshes, 1);
});

test("autorização revogada responde 401 e apaga os dados do usuário", async () => {
  const { agent } = await login();
  mock.revokeAccessTokens();
  mock.revokeRefreshTokens();

  await agent.get("/api/spotify/me").expect(401);

  assert.equal((await knex("auth")).length, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("falha do Spotify responde 502 e mantém a sessão", async () => {
  const { agent } = await login();
  mock.failMe = true;

  await agent.get("/api/spotify/me").expect(502);

  assert.equal((await knex("sessions")).length, 1);
});

test("Spotify fora do ar responde 502 e mantém a sessão", async () => {
  const { agent } = await login();
  const originalUrl = process.env.SPOTIFY_API_URL;
  process.env.SPOTIFY_API_URL = "http://127.0.0.1:1";

  try {
    await agent.get("/api/spotify/me").expect(502);
  } finally {
    process.env.SPOTIFY_API_URL = originalUrl;
  }

  assert.equal((await knex("sessions")).length, 1);
});

test("tokens ilegíveis após troca da chave exigem novo login", async () => {
  const { agent } = await login();
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

  try {
    await agent.get("/api/spotify/me").expect(401);
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  }

  assert.equal((await knex("auth")).length, 0);
});

test("logout encerra a sessão e apaga os tokens", async () => {
  const { agent } = await login();

  await agent.post("/api/spotify/logout").expect(204);

  await agent.get("/api/spotify/me").expect(401);
  assert.equal((await knex("auth")).length, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("logout mantém os tokens enquanto houver outra sessão do usuário", async () => {
  const first = await login();
  const second = await login();

  await first.agent.post("/api/spotify/logout").expect(204);

  await first.agent.get("/api/spotify/me").expect(401);
  await second.agent.get("/api/spotify/me").expect(200);
});

test("rotas desconhecidas da API respondem 404 em JSON", async () => {
  const res = await request(app).get("/api/nao-existe").expect(404);
  assert.ok(res.body.error);
});
