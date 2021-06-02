const router = require("express").Router();
const queries = require("../../config/queries/queriesGithub");
const axios = require("axios");
require("dotenv").config();

async function getUser(token) {
  const response = await axios.get("https://api.github.com/user", {
    headers: { authorization: `token ${token}` },
  });
  return await response.data;
}

router.get("/", (req, res) => {
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}&scope=repo`
  );
});

router.get("/github-auth-callback", async (req, res) => {
  try {
    const code = req.query.code;
    const body = {
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      code: code,
    };
    const opts = { headers: { accept: "application/json" } };
    const response = await axios.post(
      `https://github.com/login/oauth/access_token`,
      body,
      opts
    );
    const token = await response.data.access_token;
    const user = await getUser(token);

    const data = {
      token: token,
      username: user.login,
    };

    await queries.saveToken(data);

    res.redirect(
      `${
        process.env.NODE_ENV == "production" ? "/" : process.env.APP_URL
      }?username=${user.login}&token=${token}`
    );
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

router.post("/github-logout-user", async (req, res) => {
  var errors = [];
  if (!req.body.token) {
    errors.push("Token não informado");
  }
  if (!req.body.username) {
    errors.push("Username não informado");
  }
  if (errors.length) {
    res.status(400).json({ error: errors.join(",") });
    return;
  }

  try {
    const token = req.body.token;
    const username = req.body.username;
    const data = {
      token: token,
      username: username,
    };
    await queries.deleteToken(data);

    deleteToken;
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

router.get("/github-get-userdata/:token", async (req, res) => {
  try {
    const token = await queries.getToken(req.params.token);
    const response = await axios.get("https://api.github.com/user", {
      headers: { authorization: `token ${token.token}` },
    });
    res.json({ data: response.data });
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

router.post("/github-repositories", async (req, res) => {
  try {
    const token = req.body.token;
    const userName = req.body.user;
    const search = req.body.search;

    let query = `q=user:${userName}`;

    const response = await axios.get(
      `https://api.github.com/search/repositories?${query}`,
      {
        headers: { authorization: `token ${token}` },
      }
    );

    const repositoriesResponse = response.data.items;

    await Promise.all(
      repositoriesResponse.map(async (r) => {
        const data = {
          repository_id: r.id,
          name: r.name,
          full_name: r.full_name,
          description: r.description,
          clone_url: r.clone_url,
          html_url: r.html_url,
          user_id: r.owner.id,
        };
        await queries.saveRepository(data);
      })
    );

    const user = await getUser(token);
    const repositories = await queries.getAllRepositories(user.id, search);

    res.json({ repositories });
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

router.post("/github-repository/:id", async (req, res) => {
  try {
    const token = req.body.token;
    const user = req.body.user;

    const response = await axios.get(
      "https://api.github.com/repos/" + user + "/" + req.params.id,
      { headers: { authorization: `token ${token}` } }
    );
    const { id } = await response.data;
    const repository = await queries.getOneReposity(id);

    res.json({ data: repository });
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

router.post("/rel-tags/", async (req, res) => {
  var errors = [];
  if (!req.body.repoId) {
    errors.push("Id do repositório não informado");
  }

  if (errors.length) {
    res.status(400).json({ error: errors.join(",") });
    return;
  }

  try {
    const repoId = req.body.repoId;
    const tags = req.body.tags;

    relData = [];
    if (tags) {
      tags.map((tag) => {
        relData.push([repoId, tag]);
      });
    }

    await queries.removeTagsRepositoryRelationship(repoId);

    for (var i = 0; i < relData.length; i++) {
      const data = {
        repository_id: relData[i][0],
        tag_id: relData[i][1],
      };
      await queries.saveTagsRepositoryRelationship(data);
    }
  } catch (error) {
    console.log(error.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
