const router = require("express").Router();
const axios = require("axios");
const queries = require("../../config/queries/queriesSpotify");
require("dotenv").config();
const SpotifyWebApi = require("spotify-web-api-node");

const scopes = [
  "ugc-image-upload",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "streaming",
  "app-remote-control",
  "user-read-email",
  "user-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-read-private",
  "playlist-modify-private",
  "user-library-modify",
  "user-library-read",
  "user-top-read",
  "user-read-playback-position",
  "user-read-recently-played",
  "user-follow-read",
  "user-follow-modify",
];

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
});

async function getMyData() {
  // (async () => {
  const me = await spotifyApi.getMe();
  // console.log(me.body);
  return me.body;
  // getUserPlaylists(me.body.id);
  // })().catch((e) => {
  //   console.error(e);
  // });
}

router.get("/login", (req, res) => {
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

router.get("/callback", (req, res) => {
  const error = req.query.error;
  const code = req.query.code;
  const state = req.query.state;

  if (error) {
    console.error("Callback Error:", error);
    res.send(`Callback Error: ${error}`);
    return;
  }

  spotifyApi
    .authorizationCodeGrant(code)
    .then(async (data) => {
      const access_token = data.body["access_token"];
      const refresh_token = data.body["refresh_token"];
      const expires_in = data.body["expires_in"];

      spotifyApi.setAccessToken(access_token);
      spotifyApi.setRefreshToken(refresh_token);

      const my_data = await getMyData();

      queries.saveToken({
        token: access_token,
        refresh_token: refresh_token,
        username: my_data.id,
      });

      // console.log("access_token:", access_token);
      // console.log("refresh_token:", refresh_token);

      // console.log(
      //   `Sucessfully retreived access token. Expires in ${expires_in} s.`
      // );
      // res.send("Success! You can now close the window.");

      setInterval(async () => {
        const data = await spotifyApi.refreshAccessToken();
        const access_token = data.body["access_token"];

        console.log("The access token has been refreshed!");
        console.log("access_token:", access_token);
        spotifyApi.setAccessToken(access_token);
      }, (expires_in / 2) * 1000);

      res.redirect(
        `${
          process.env.NODE_ENV == "production" ? "/" : process.env.APP_URL
        }?username=${user.login}&token=${token}`
      );
    })
    .catch((error) => {
      console.error("Error getting Tokens:", error);
      res.send(`Error getting Tokens: ${error}`);
    });
});

module.exports = router;
