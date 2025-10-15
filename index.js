const express = require('express');
const https = require('https'); // Módulo nativo para HTTPS
const http = require('http');   // Módulo nativo para HTTP
const fs = require('fs');       // Módulo nativo para ler arquivos
const basicAuth = require('express-basic-auth');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const db = require('./json-db');

const app = express();

// --- CONFIGURAÇÃO E MIDDLEWARES (sem mudanças aqui) ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use('/gerar/admin', basicAuth({
    users: { 'devlima': 'devlima' },
    challenge: true,
    realm: 'AdminPanel',
}));


// --- ROTAS (exatamente as mesmas de antes) ---

// Rota do painel de admin
app.get('/gerar/admin', async (req, res) => { /* ... seu código da rota ... */ });
// Rota de cadastro
app.post('/gerar/admin/cadastrar', async (req, res) => { /* ... seu código da rota ... */ });
// Rota de download do QR Code
app.get('/gerar/admin/qrcode/:uuid', async (req, res) => { /* ... seu código da rota ... */ });
// Rota pública de registro
app.get('/registrar/:uuid', async (req, res) => { /* ... seu código da rota ... */ });
// (Copie e cole aqui as 4 funções de rota completas da resposta anterior para não perder a lógica)


// --- CRIAÇÃO DOS SERVIDORES ---

// 1. Configurações do certificado SSL
const privateKeyPath = '/etc/letsencrypt/live/simposio.devlima.wtf/privkey.pem';
const certificatePath = '/etc/letsencrypt/live/simposio.devlima.wtf/fullchain.pem';

// Verifique se os arquivos de certificado existem antes de prosseguir
if (!fs.existsSync(privateKeyPath) || !fs.existsSync(certificatePath)) {
    console.error('ERRO: Arquivos de certificado SSL não encontrados.');
    console.error('Execute o Certbot primeiro: sudo certbot certonly --standalone -d simposio.devlima.wtf');
    process.exit(1); // Encerra a aplicação se não houver certificados
}

const httpsOptions = {
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(certificatePath),
};

// 2. Servidor HTTPS principal na porta 443
const httpsServer = https.createServer(httpsOptions, app);
httpsServer.listen(443, () => {
    console.log('Servidor HTTPS rodando na porta 443');
});

// 3. Servidor HTTP simples na porta 80 apenas para redirecionar
const httpServer = http.createServer((req, res) => {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
});
httpServer.listen(80, () => {
    console.log('Servidor HTTP rodando na porta 80 (para redirecionamento)');
});