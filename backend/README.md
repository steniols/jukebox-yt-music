## Requirements

* Docker(v20.10.6) installed.
* PostgreSQL(v12.6) installed.
* Node(v15.3.0) and Npm(7.11.2) installed.
* Create a [Spotify App](https://developer.spotify.com/dashboard/):
  1) *Homepage URL* must be `http:localhost:4200`
  2) *Authorization callback URL* must be `http://localhost:8003/spotify/callback`
  3) Generate a Client Secret and save both *Client ID* and *Client Secret* for use later.

## Install API (backend)

First we need to create a `.env` file and update its variables with your local Postgres configs and Spotify APP *Client ID* and *Client Secret*:

```bash
cp .env.sample .env
```
Update this variables below with your Spotify credentials:

```bash
CLIENT_ID=<CLIENT-ID>
CLIENT_SECRET=<SECRET-KEY>
```

Install Node dependencies
```bash
npm install
```
## Database Setup

Run the command below that will create the database inside a Docker image:

```bash
docker run -d -p 5432:5432 -e POSTGRES_USERNAME=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=appspot postgres:12.6
```

Run all migrations (create all tables):

```bash
npx knex migrate:latest 
```

## Start API

```bash
npm start
```
