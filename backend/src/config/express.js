require("./env");

const path = require("path");
const cookieParser = require("cookie-parser");
const express = require("express");

const app = express();

app.disable("x-powered-by");
app.use(cookieParser());
app.use(express.json());

app.use("/api/spotify", require("../app/routes/spotify"));
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

if (process.env.NODE_ENV === "production") {
  const frontendDir = path.join(__dirname, "../../../frontend/dist/frontend");
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
