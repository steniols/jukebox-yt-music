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
const { decrypt } = require("../src/app/services/tokenCipher");

const ALICE = { sub: "alice", name: "Alice" };
const API = "/api/youtube";

let mock;
let mockServer;

async function startLogin(agent) {
  const res = await agent.get(`${API}/login`).expect(302);
  return new URL(res.headers.location).searchParams.get("state");
}

async function login(user = ALICE) {
  const agent = request.agent(app);
  const state = await startLogin(agent);
  const callback = await agent
    .get(`${API}/callback`)
    .query({ code: mock.issueCode(user), state })
    .expect(302);
  return { agent, callback };
}

const expireToken = () =>
  knex("auth").update({ expires_at: new Date(Date.now() - 1000) });

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

// Login e sessão

test("/login pede acesso offline ao YouTube e guarda o state em cookie httpOnly", async () => {
  const res = await request(app).get(`${API}/login`).expect(302);
  const target = new URL(res.headers.location);
  const params = target.searchParams;

  assert.equal(target.pathname, "/o/oauth2/v2/auth");
  assert.equal(params.get("client_id"), "test-client");
  assert.equal(params.get("access_type"), "offline");
  assert.equal(params.get("prompt"), "consent");
  assert.ok(params.get("scope").includes("https://www.googleapis.com/auth/youtube"));

  const cookie = res.headers["set-cookie"][0];
  assert.ok(cookie.includes(params.get("state")));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test("callback com state ausente ou incorreto não troca o code nem cria sessão", async () => {
  const agent = request.agent(app);
  await startLogin(agent);

  for (const query of [{}, { state: "errado" }]) {
    const res = await agent
      .get(`${API}/callback`)
      .query({ ...query, code: mock.issueCode() })
      .expect(302);
    assert.equal(res.headers.location, "/?login_error=invalid_state");
  }

  assert.equal(mock.stats.exchanges, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("recusa do usuário no Google volta como login_error", async () => {
  const agent = request.agent(app);
  const state = await startLogin(agent);

  const res = await agent
    .get(`${API}/callback`)
    .query({ error: "access_denied", state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=access_denied");
});

test("code rejeitado pelo Google volta como login_error sem criar sessão", async () => {
  const agent = request.agent(app);
  const state = await startLogin(agent);

  const res = await agent
    .get(`${API}/callback`)
    .query({ code: "code-invalido", state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=google_error");
  assert.equal((await knex("sessions")).length, 0);
});

test("login sem a permissão do YouTube é recusado", async () => {
  const agent = request.agent(app);
  const state = await startLogin(agent);

  const res = await agent
    .get(`${API}/callback`)
    .query({ code: mock.issueCode(ALICE, { scope: "openid profile" }), state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=missing_scope");
  assert.equal((await knex("sessions")).length, 0);
});

test("login sem refresh token é recusado", async () => {
  const agent = request.agent(app);
  const state = await startLogin(agent);

  const res = await agent
    .get(`${API}/callback`)
    .query({ code: mock.issueCode(ALICE, { withRefreshToken: false }), state })
    .expect(302);

  assert.equal(res.headers.location, "/?login_error=google_error");
  assert.equal((await knex("auth")).length, 0);
});

test("login completo cria sessão sem expor tokens ao navegador", async () => {
  const { agent, callback } = await login();

  assert.equal(callback.headers.location, "/");
  const session = callback.headers["set-cookie"].find((c) =>
    c.startsWith("session=")
  );
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);

  const me = await agent.get(`${API}/me`).expect(200);
  assert.deepEqual(me.body, { data: { id: "alice", display_name: "Alice" } });
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

test("rotas protegidas respondem 401 sem cookie ou com sessão desconhecida", async () => {
  await request(app).get(`${API}/me`).expect(401);
  await request(app)
    .get(`${API}/me`)
    .set("Cookie", "session=nao-existe")
    .expect(401);
});

test("/me responde 401 quando a sessão expirou", async () => {
  const { agent } = await login();
  await knex("sessions").update({ expires_at: new Date(Date.now() - 1000) });
  await agent.get(`${API}/me`).expect(401);
});

test("token vencido é renovado e salvo, sem renovar de novo", async () => {
  const { agent } = await login();
  await expireToken();
  const [before] = await knex("auth");

  await agent.get(`${API}/me`).expect(200);
  await agent.get(`${API}/me`).expect(200);

  const [saved] = await knex("auth");
  assert.equal(mock.stats.refreshes, 1);
  assert.notEqual(decrypt(saved.token), decrypt(before.token));
  assert.equal(decrypt(saved.refresh_token), decrypt(before.refresh_token));
  assert.ok(new Date(saved.expires_at) > new Date());
});

test("refresh token trocado pelo Google é salvo", async () => {
  mock.rotateRefreshToken = true;
  const { agent } = await login();
  await expireToken();
  const [before] = await knex("auth");

  await agent.get(`${API}/me`).expect(200);

  const [saved] = await knex("auth");
  assert.notEqual(decrypt(saved.refresh_token), decrypt(before.refresh_token));
});

test("requisições simultâneas com token vencido renovam uma única vez", async () => {
  mock.rotateRefreshToken = true;
  const { agent } = await login();
  await expireToken();

  await Promise.all([
    agent.get(`${API}/me`).expect(200),
    agent.get(`${API}/me`).expect(200),
    agent.get(`${API}/me`).expect(200),
  ]);

  assert.equal(mock.stats.refreshes, 1);
});

test("token invalidado antes do prazo é renovado automaticamente", async () => {
  const { agent } = await login();
  mock.revokeAccessTokens();

  await agent.get(`${API}/me`).expect(200);

  assert.equal(mock.stats.refreshes, 1);
});

test("autorização revogada responde 401 e apaga os dados do usuário", async () => {
  const { agent } = await login();
  mock.revokeAccessTokens();
  mock.revokeRefreshTokens();

  await agent.get(`${API}/me`).expect(401);

  assert.equal((await knex("auth")).length, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("tokens ilegíveis após troca da chave exigem novo login", async () => {
  const { agent } = await login();
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

  try {
    await agent.get(`${API}/me`).expect(401);
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  }

  assert.equal((await knex("auth")).length, 0);
});

test("secret incorreto no servidor responde 502 sem apagar os tokens do usuário", async () => {
  const { agent } = await login();
  await expireToken();
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_SECRET = "secret-errado";

  try {
    await agent.get(`${API}/me`).expect(502);
  } finally {
    process.env.GOOGLE_CLIENT_SECRET = originalSecret;
  }

  assert.equal((await knex("auth")).length, 1);
  await agent.get(`${API}/me`).expect(200);
});

test("Google fora do ar responde 502 e mantém a sessão", async () => {
  const { agent } = await login();
  const originalUrl = process.env.GOOGLE_MOCK_URL;
  process.env.GOOGLE_MOCK_URL = "http://127.0.0.1:1";

  try {
    await agent.get(`${API}/me`).expect(502);
  } finally {
    process.env.GOOGLE_MOCK_URL = originalUrl;
  }

  assert.equal((await knex("sessions")).length, 1);
});

test("logout encerra a sessão e apaga os tokens", async () => {
  const { agent } = await login();

  await agent.post(`${API}/logout`).expect(204);

  await agent.get(`${API}/me`).expect(401);
  assert.equal((await knex("auth")).length, 0);
  assert.equal((await knex("sessions")).length, 0);
});

test("logout mantém os tokens enquanto houver outra sessão do usuário", async () => {
  const first = await login();
  const second = await login();

  await first.agent.post(`${API}/logout`).expect(204);

  await first.agent.get(`${API}/me`).expect(401);
  await second.agent.get(`${API}/me`).expect(200);
});

test("rotas desconhecidas da API respondem 404 em JSON", async () => {
  const res = await request(app).get("/api/nao-existe").expect(404);
  assert.ok(res.body.error);
});
