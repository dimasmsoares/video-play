# Video Play

Uma biblioteca privada de vídeos com login, navegação por pastas e streaming direto no navegador. Roda sem banco de dados e sem dependências externas — apenas Node.js e os arquivos de vídeo no disco.

## Como funciona

O app lê uma pasta do servidor (configurada em `VIDEO_ROOT`) e expõe seu conteúdo como uma biblioteca navegável. Cada subpasta vira uma seção, e os vídeos dentro delas aparecem em grade.

O streaming usa **HTTP Range Requests**, o que permite avançar e retroceder no player sem baixar o arquivo inteiro. Isso é necessário para que o player funcione corretamente em iPhone, iPad e Safari.

O login é protegido por senha com hash `scrypt`. A sessão é mantida via cookie assinado com HMAC — sem banco de dados, sem estado no servidor.

Cada vídeo pode receber uma **nota de 0 a 10**, atribuída tanto pelo card na grade quanto logo abaixo do player durante a reprodução. As notas ficam salvas em `data/ratings.json` e podem ser usadas para ordenar os vídeos.

Formatos reconhecidos: `.mp4`, `.m4v`, `.webm`, `.mov`, `.mkv`, `.avi`, `.m3u8`.

> Para compatibilidade máxima em celular e tablet, prefira arquivos `.mp4` com codec **H.264** e áudio **AAC**. Arquivos `.mkv` podem não tocar no Safari/iOS mesmo aparecendo na biblioteca.

---

## Pré-requisitos

- **Node.js >= 20** — [nodejs.org](https://nodejs.org)
- Uma pasta de vídeos no servidor

Verifique a versão instalada:

```bash
node --version
```

---

## Rodando localmente (desenvolvimento)

Clone o repositório e crie o arquivo de configuração:

```bash
git clone <seu-repositorio> video-play
cd video-play
cp .env.example .env
```

Edite o `.env` e aponte `VIDEO_ROOT` para a pasta com seus vídeos. Em seguida:

```bash
npm run dev
```

Acesse `http://localhost:3000`. As credenciais padrão são `admin` / `admin` — servem apenas para teste local.

---

## Configuração

Todas as configurações são feitas via variáveis de ambiente, definidas no arquivo `.env`.

### Variáveis disponíveis

| Variável | Descrição | Exemplo |
|---|---|---|
| `PORT` | Porta HTTP do servidor | `3000` |
| `NODE_ENV` | Modo de execução | `production` |
| `VIDEO_ROOT` | Caminho absoluto da pasta de vídeos | `/srv/videos` |
| `APP_USERNAME` | Nome de usuário para login | `admin` |
| `APP_PASSWORD` | Senha em texto puro (só para dev) | `admin` |
| `APP_PASSWORD_HASH` | Senha com hash (recomendado para produção) | `scrypt:...` |
| `SESSION_SECRET` | Chave secreta para assinar os cookies de sessão | string aleatória longa |
| `TRUST_PROXY` | Defina `true` se usar Nginx ou outro proxy reverso na frente | `true` |

### Gerando um hash de senha

Nunca use senha em texto puro em produção. Gere um hash com:

```bash
npm run hash-password -- "sua-senha-forte"
```

O comando imprime um valor no formato `scrypt:salt:hash`. Copie esse valor para `APP_PASSWORD_HASH` no `.env` e remova a linha `APP_PASSWORD`.

### Gerando um SESSION_SECRET

O `SESSION_SECRET` é a chave que assina os cookies de autenticação. Use uma string aleatória longa:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Cole o resultado no `.env`.

---

## Deploy em servidor (sem Docker) com PM2

O PM2 é um gerenciador de processos que mantém o app rodando e o reinicia automaticamente após falhas ou reinicializações do servidor.

**1. Instale o PM2 globalmente:**

```bash
npm install -g pm2
```

**2. Clone o projeto e configure:**

```bash
git clone <seu-repositorio> video-play
cd video-play
cp .env.example .env
nano .env   # edite as variáveis conforme a seção anterior
```

**3. Carregue as variáveis de ambiente e inicie o app:**

```bash
set -a && . ./.env && set +a
pm2 start server.js --name video-play
```

**4. Salve a lista de processos e configure a inicialização automática no boot:**

```bash
pm2 save
pm2 startup
```

O `pm2 startup` vai imprimir um comando com `sudo` — copie e execute esse comando para registrar o PM2 como serviço do sistema. Depois disso, o app vai iniciar automaticamente ao ligar o servidor.

**Comandos úteis do PM2:**

```bash
pm2 list                  # Lista os processos rodando
pm2 logs video-play       # Exibe os logs em tempo real
pm2 restart video-play    # Reinicia o app (após atualizar o código, por exemplo)
pm2 stop video-play       # Para o app
```

---

## Deploy com Docker

**1. Clone e configure:**

```bash
git clone <seu-repositorio> video-play
cd video-play
cp .env.example .env
nano .env
```

**2. Build da imagem:**

```bash
docker build -t video-play .
```

**3. Inicie o container:**

```bash
docker run -d \
  --name video-play \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v /caminho/da/sua/pasta/de/videos:/srv/videos:ro \
  -v /caminho/para/dados:/app/data \
  video-play
```

O flag `:ro` monta a pasta de vídeos como somente leitura — o app nunca modifica os arquivos originais. O volume `/app/data` persiste as notas atribuídas aos vídeos entre reinicializações do container.

**Comandos úteis:**

```bash
docker logs -f video-play     # Logs em tempo real
docker restart video-play     # Reinicia o container
docker stop video-play        # Para o container
```

---

## Proxy reverso com Nginx e HTTPS

Em produção, coloque o Nginx na frente para terminar o HTTPS e repassar as requisições para o app. Crie um arquivo de configuração em `/etc/nginx/sites-available/video-play`:

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

Ative o site e configure HTTPS com Certbot:

```bash
sudo ln -s /etc/nginx/sites-available/video-play /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d videos.seudominio.com
```

Quando usar Nginx na frente, defina `TRUST_PROXY=true` no `.env` para que os cookies de sessão usem o flag `Secure` corretamente.

---

## Checklist de segurança antes de expor na internet

- [ ] Trocar `APP_USERNAME` e definir `APP_PASSWORD_HASH` (nunca usar `APP_PASSWORD` em produção)
- [ ] Gerar um `SESSION_SECRET` aleatório e longo
- [ ] Usar HTTPS (via Nginx + Certbot)
- [ ] Definir `TRUST_PROXY=true` se houver proxy reverso
- [ ] Não expor a porta `3000` diretamente — deixe o Nginx como ponto de entrada
- [ ] Montar a pasta de vídeos como somente leitura (`:ro` no Docker, ou permissões de SO no PM2)
