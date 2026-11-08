// Cria o banco de testes caso ele ainda não exista.
require("../src/config/env");
const { Client } = require("pg");

async function main() {
  const database = process.env.PG_DATABASE_TEST;
  const client = new Client({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: "postgres",
  });

  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Não foi possível preparar o banco de testes: ${error.message}`);
  process.exit(1);
});
