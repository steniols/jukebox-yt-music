// Simulador local das partes do Spotify usadas pelo app. Serve para testar o
// fluxo completo sem conta Premium; nunca conversa com o Spotify de verdade.
const crypto = require("crypto");
const express = require("express");

const DEFAULT_USER = { id: "usuario-mock", display_name: "Usuário Simulado" };

function createMockSpotify({ clientId, clientSecret } = {}) {
  const codes = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();
  const newToken = (prefix) =>
    `${prefix}-${crypto.randomBytes(16).toString("hex")}`;

  const mock = {
    stats: { exchanges: 0, refreshes: 0 },
    failMe: false,
    rotateRefreshToken: false,
    expiresIn: 3600,

    issueCode(user = DEFAULT_USER) {
      const code = newToken("code");
      codes.set(code, user);
      return code;
    },
    revokeAccessTokens() {
      accessTokens.clear();
    },
    revokeRefreshTokens() {
      refreshTokens.clear();
    },
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/authorize", (req, res) => {
    const { client_id: id, redirect_uri: redirectUri, state } = req.query;
    if (clientId && id !== clientId) {
      return res.status(400).send("client_id inválido");
    }
    const target = new URL(redirectUri);
    target.searchParams.set("code", mock.issueCode());
    target.searchParams.set("state", state);
    res.redirect(target.toString());
  });

  app.post("/api/token", (req, res) => {
    const expected = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );
    if (clientId && req.get("authorization") !== `Basic ${expected}`) {
      return res.status(400).json({ error: "invalid_client" });
    }

    let user;
    const body = { token_type: "Bearer", expires_in: mock.expiresIn };

    if (req.body.grant_type === "authorization_code") {
      user = codes.get(req.body.code);
      if (!user) return res.status(400).json({ error: "invalid_grant" });
      codes.delete(req.body.code);
      mock.stats.exchanges += 1;
      body.refresh_token = newToken("refresh");
      refreshTokens.set(body.refresh_token, user);
    } else if (req.body.grant_type === "refresh_token") {
      user = refreshTokens.get(req.body.refresh_token);
      if (!user) return res.status(400).json({ error: "invalid_grant" });
      mock.stats.refreshes += 1;
      if (mock.rotateRefreshToken) {
        refreshTokens.delete(req.body.refresh_token);
        body.refresh_token = newToken("refresh");
        refreshTokens.set(body.refresh_token, user);
      }
    } else {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }

    body.access_token = newToken("access");
    accessTokens.set(body.access_token, user);
    res.json(body);
  });

  app.get("/v1/me", (req, res) => {
    if (mock.failMe) return res.status(500).json({ error: "server_error" });
    const token = (req.get("authorization") || "").replace(/^Bearer /, "");
    const user = accessTokens.get(token);
    if (!user) return res.status(401).json({ error: "invalid_token" });
    res.json(user);
  });

  mock.app = app;
  return mock;
}

module.exports = { createMockSpotify };
