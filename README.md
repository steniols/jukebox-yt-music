# Jukebox colaborativa

Você entra com sua conta Google, cria uma jukebox e compartilha o link. Quem tiver o link ativo adiciona músicas e vota na próxima, sem precisar de conta. As músicas tocam no navegador de quem criou e também são adicionadas a uma playlist no YouTube dessa pessoa.

Usa frontend em Angular 21 (`web/`), backend em Express, Knex e PostgreSQL (`backend/`) e a [YouTube Data API v3](https://developers.google.com/youtube/v3), porque o YouTube Music não tem API oficial própria. Não é um produto do Google nem do YouTube.

## Como funciona

- **Link:** é secreto e dá acesso sem login. Quem criou pode encerrá-lo, reativá-lo ou gerar um novo, o que invalida o anterior na hora.
- **Músicas:** os convidados colam um link do YouTube ou do YouTube Music.
- **Importar playlist:** só quem criou pode importar, até 50 músicas por vez. Elas ficam apenas na fila da jukebox e não são copiadas para a playlist do YouTube, o que custa cerca de 2 unidades da cota.
- **Votos:** cada navegador tem um voto por rodada. Votar em outra música move o voto. A mais votada toca em seguida; no empate, a que chegou primeiro. Os votos zeram a cada música.
- **Reprodução:** só o navegador de quem criou toca, e a página precisa ficar aberta.
- **Atualização:** as telas buscam o estado a cada 3 segundos.

## Requisitos

- Node.js 22.12 ou superior
- Docker com Docker Compose

## Como rodar

Na primeira vez, prepare o banco e as dependências, a partir da raiz do projeto:

```bash
docker compose up -d --wait
cd backend
cp .env.sample .env
npm install
npm run migrate
cd ../web
npm install
```

Depois, inicie o backend e o frontend em dois terminais:

```bash
# Terminal 1: depois de configurar a seção "Login"
cd backend
npm run dev

# Terminal 2
cd web
npm start
```

Acesse **http://127.0.0.1:4200**. Use esse endereço, e não `localhost`, para que o cookie de sessão funcione.

Nesse modo, o link só abre no seu computador. Para outras pessoas entrarem, o app precisa estar publicado em um endereço HTTPS.

## Login

O app usa sua conta Google real:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Em [Google Auth Platform](https://console.cloud.google.com/auth/branding), configure o app com público **Externo**. Em **Audience > Test users**, adicione seu e-mail. Os convidados não precisam ser adicionados, porque não fazem login.
3. Em [Clients](https://console.cloud.google.com/auth/clients), crie um cliente do tipo **Web application**, com o redirect `http://127.0.0.1:4200/api/youtube/callback`.
4. Em `backend/.env`, preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
5. Gere a chave abaixo e coloque o resultado em `TOKEN_ENCRYPTION_KEY`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. Inicie o backend com `npm run dev`.

O Google pode avisar que o app não foi verificado; isso é esperado enquanto ele estiver em teste. Nesse modo, a autorização vence em 7 dias. Até você entrar de novo, a fila e os votos continuam, mas novas músicas são recusadas com um aviso.

## Limites

- **Cota do YouTube:** o padrão é de 10.000 unidades por dia, por projeto. Cada música adicionada custa 51 (1 para consultar e 50 para incluir na playlist), o que dá cerca de 190 músicas por dia. Criar uma jukebox e remover uma música custam 50.
- **Sem cota para a playlist:** a música entra na fila e toca, mas não vai para a playlist do YouTube.
- **Proteção contra abuso:** 5 músicas por minuto por pessoa, 20 por minuto por jukebox e 100 na fila.
- **Votos:** são identificados por um cookie do navegador. Quem limpar os cookies ou trocar de navegador pode votar de novo.
- **Conta:** criar playlists pode exigir um canal no YouTube. Sem ele, o app mostra um aviso.
- **Vídeos:** ao vivo, com restrição de idade ou que não permitem incorporação são recusados.

## Testes

Com o banco no ar, execute em `backend`:

```bash
npm test
```

Os testes não acessam o Google nem gastam sua cota: usam um simulador interno e o banco `appspot-test`, criado automaticamente. O frontend ainda não tem testes automatizados no repositório.

## Segurança

- **Sessão:** o navegador recebe apenas um cookie `httpOnly`; os tokens do Google ficam criptografados no banco e nunca chegam a ele.
- **Link:** o banco guarda o hash e uma cópia criptografada, que permite mostrá-lo de novo a quem criou.
- **Player:** a API do YouTube envia a URL da página ao YouTube. Por isso, o player roda em `/tocar/:id`, que não contém o link secreto, e nunca em `/j/:token`.

Em desenvolvimento, o `ng serve` encaminha `/api` para o backend pelo [proxy.conf.json](web/proxy.conf.json). Em produção, o Express serve o build em `web/dist/frontend/browser`, e os cookies exigem HTTPS.
