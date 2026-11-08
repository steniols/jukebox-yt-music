# crud-spotify

Aplicação de estudo com login pelo Spotify: frontend em Angular 9 e backend em Express, Knex e PostgreSQL.

## Requisitos

- Node.js 22 ou superior
- Docker com Docker Compose

## Como rodar

Na primeira vez, prepare o banco e as dependências, a partir da raiz do projeto:

```bash
docker compose up -d --wait
cd backend
cp .env.sample .env
npm install
npm run migrate
cd ../frontend
npm install
```

Depois, inicie o backend e o frontend em dois terminais:

```bash
# Terminal 1: escolha uma das opções da seção "Login"
cd backend
npm run dev:mock

# Terminal 2
cd frontend
npm start
```

Acesse **http://127.0.0.1:4200**. Use esse endereço, e não `localhost`, para que o cookie de sessão funcione.

## Login

### Com o Spotify simulado (sem conta Premium)

`npm run dev:mock` sobe o backend junto com um simulador local do Spotify. O login entra direto como "Usuário Simulado", sem credenciais e sem acessar o Spotify de verdade. O simulador não funciona em produção.

### Com o Spotify real

Apps em modo de desenvolvimento exigem que o dono da conta tenha Spotify Premium.

1. Crie um app no [painel do Spotify](https://developer.spotify.com/dashboard) e registre o redirect `http://127.0.0.1:4200/api/spotify/callback`.
2. Em `backend/.env`, preencha `CLIENT_ID` e `CLIENT_SECRET`.
3. Gere a chave abaixo e coloque o resultado em `TOKEN_ENCRYPTION_KEY`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Inicie o backend com `npm run dev`.

## Testes

Com o banco no ar, execute em `backend`:

```bash
npm test
```

Os testes usam o simulador do Spotify e o banco `appspot-test`, criado automaticamente.

## Como funciona o login

1. O frontend redireciona para `/api/spotify/login`, e o backend envia o usuário ao Spotify com um `state` aleatório.
2. No callback, o backend valida o `state`, troca o código por tokens e os salva criptografados.
3. O navegador recebe apenas um cookie de sessão `httpOnly`; os tokens do Spotify nunca chegam a ele.
4. O backend renova o token de acesso quando necessário.

Em desenvolvimento, o `ng serve` encaminha `/api` para o backend pelo [proxy.conf.json](frontend/proxy.conf.json). Em produção, o Express serve o build do frontend em `frontend/dist/frontend`, e o cookie exige HTTPS.
