// Sobe o backend apontando para o simulador do Spotify (sem conta Premium).
if (process.env.NODE_ENV === "production") {
  throw new Error("O simulador do Spotify não pode ser usado em produção.");
}

const { createMockSpotify } = require("./mock-spotify");

const MOCK_PORT = 8004;

Object.assign(process.env, {
  CLIENT_ID: "mock-client",
  CLIENT_SECRET: "mock-secret",
  REDIRECT_URI: "http://127.0.0.1:4200/api/spotify/callback",
  // Chave fixa e pública: protege apenas os tokens falsos do simulador.
  TOKEN_ENCRYPTION_KEY: "00".repeat(32),
  SPOTIFY_ACCOUNTS_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SPOTIFY_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
});

const mock = createMockSpotify({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
});

mock.app.listen(MOCK_PORT, "127.0.0.1", () => {
  console.log(`Spotify simulado em http://127.0.0.1:${MOCK_PORT}`);
  require("../server");
});
