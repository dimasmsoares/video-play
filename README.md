# Video Play

Uma biblioteca privada de videos com login, navegacao por pastas e streaming no navegador.

## O que ela faz

- Protege a biblioteca com usuario e senha.
- Lista subpastas dentro da pasta configurada em `VIDEO_ROOT`.
- Toca videos no navegador com suporte a `Range`, necessario para iPhone, iPad, Safari e avance/retrocesso no player.
- Funciona sem banco de dados e sem dependencias externas.

Extensoes reconhecidas: `.mp4`, `.m4v`, `.webm`, `.mov`, `.mkv`, `.avi`, `.m3u8`.

Para compatibilidade maxima em celular e tablet, prefira videos `.mp4` com codec H.264 e audio AAC. Arquivos `.mkv` podem nao tocar no Safari/iOS mesmo aparecendo na biblioteca.

## Rodar localmente

```bash
npm start
```

Abra `http://localhost:3000`.

Credenciais padrao apenas para teste:

- Usuario: `admin`
- Senha: `admin`

Antes de expor na internet, configure senha forte e segredo de sessao.

## Gerar hash de senha

```bash
npm run hash-password -- "sua-senha-forte"
```

Copie o valor gerado para `APP_PASSWORD_HASH`.

## Variaveis de ambiente

```bash
PORT=3000
NODE_ENV=production
VIDEO_ROOT=/srv/videos
APP_USERNAME=seu-usuario
APP_PASSWORD_HASH=scrypt:...
SESSION_SECRET=uma-string-aleatoria-grande
```

`VIDEO_ROOT` deve apontar para a pasta da VPS que contem suas subpastas de videos.

## Deploy com Docker

Na VPS:

```bash
git clone <seu-repositorio> video-play
cd video-play
cp .env.example .env
nano .env
docker build -t video-play .
docker run -d \
  --name video-play \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v /caminho/da/sua/pasta/de/videos:/srv/videos:ro \
  video-play
```

Use `:ro` para montar a pasta de videos como somente leitura dentro do container.

## Deploy sem Docker, com PM2

```bash
cd video-play
npm install --omit=dev
npm run hash-password -- "sua-senha-forte"
```

Crie um arquivo `.env` e rode:

```bash
set -a
. ./.env
set +a
npm install -g pm2
pm2 start server.js --name video-play
pm2 save
pm2 startup
```

## Nginx com HTTPS

Exemplo de reverse proxy:

```nginx
server {
    server_name videos.seudominio.com;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois configure HTTPS com Certbot:

```bash
certbot --nginx -d videos.seudominio.com
```

## Seguranca basica

- Use HTTPS sempre.
- Troque `APP_USERNAME`, `APP_PASSWORD_HASH` e `SESSION_SECRET`.
- Nao exponha a porta `3000` diretamente se puder usar Nginx na frente.
- Mantenha a pasta de videos montada como somente leitura.
- Para algo mais robusto no futuro, o proximo passo natural e adicionar usuarios em banco, capas/posters e progresso de reproducao.
