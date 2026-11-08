// O app passou a usar o login do Google: os tokens do Spotify não servem mais.
// As sessões são removidas em cascata, e cada usuário só precisa entrar de novo.
exports.up = function (knex) {
  return knex("auth").del();
};

exports.down = function () {
  return Promise.resolve();
};
