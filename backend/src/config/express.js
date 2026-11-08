require("./env");

const path = require("path");
const cookieParser = require("cookie-parser");
const express = require("express");

const app = express();

app.disable("x-powered-by");
app.use(cookieParser());
app.use(express.json());

// O link da jukebox é um segredo: as páginas não podem repassá-lo a outros sites.
app.use((req, res, next) => {
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const { jukeboxes, rooms } = require("../app/routes/jukebox");

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api/youtube", require("../app/routes/youtube"));
app.use("/api/jukeboxes", jukeboxes);
app.use("/api/rooms/:token", rooms);
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

if (process.env.NODE_ENV === "production") {
  const frontendDir = path.join(__dirname, "../../../web/dist/frontend/browser");
  app.use(express.static(frontendDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(500).json({ error: "Erro interno do servidor" });
});

module.exports = app;
