const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const basicAuth = require('express-basic-auth');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const db = require('./json-db');

const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use('/gerar/admin', basicAuth({
    users: { devlima: 'devlima' },
    challenge: true,
    realm: 'AdminPanel',
}));

function formatDate(isoString) {
    try {
        return new Date(isoString).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        });
    } catch (_) {
        return null;
    }
}

function buildAlert(statusCode) {
    switch (statusCode) {
        case 'created':
            return { message: 'Aluno cadastrado com sucesso.', type: 'success' };
        case 'duplicate':
            return { message: 'Já existe um aluno cadastrado com essa matrícula.', type: 'error' };
        case 'invalid':
            return { message: 'Informe o nome completo e a matrícula para concluir o cadastro.', type: 'error' };
        default:
            return null;
    }
}

app.get('/gerar/admin', async (req, res) => {
    try {
        const data = await db.readDB();
        const alunos = Array.isArray(data.alunos) ? data.alunos : [];
        alunos.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, 'pt-BR'));

        const alertInfo = buildAlert(req.query.status);

        res.render('admin', {
            alunos,
            alertMessage: alertInfo?.message ?? null,
            alertType: alertInfo?.type ?? null,
        });
    } catch (error) {
        console.error('Erro ao carregar painel administrativo:', error);
        res.status(500).render('erro', {
            mensagem: 'Não foi possível carregar o painel administrativo. Tente novamente em instantes.',
        });
    }
});

app.post('/gerar/admin/cadastrar', async (req, res) => {
    const nome = req.body.nome?.trim();
    const matricula = req.body.matricula?.trim();

    if (!nome || !matricula) {
        return res.redirect('/gerar/admin?status=invalid');
    }

    try {
        const data = await db.readDB();
        data.alunos = Array.isArray(data.alunos) ? data.alunos : [];

        const jaExiste = data.alunos.some((aluno) => aluno.matricula.toLowerCase() === matricula.toLowerCase());
        if (jaExiste) {
            return res.redirect('/gerar/admin?status=duplicate');
        }

        const novoAluno = {
            uuid: uuidv4(),
            nome_completo: nome,
            matricula,
            criado_em: new Date().toISOString(),
        };

        data.alunos.push(novoAluno);
        await db.writeDB(data);

        res.redirect('/gerar/admin?status=created');
    } catch (error) {
        console.error('Erro ao cadastrar aluno:', error);
        res.status(500).render('erro', {
            mensagem: 'Não foi possível cadastrar o aluno no momento. Tente novamente.',
        });
    }
});

app.get('/gerar/admin/qrcode/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        const data = await db.readDB();
        const alunos = Array.isArray(data.alunos) ? data.alunos : [];
        const aluno = alunos.find((registro) => registro.uuid === uuid);

        if (!aluno) {
            return res.status(404).render('erro', {
                mensagem: 'Aluno não encontrado para gerar o QR Code.',
            });
        }

        const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host = req.headers.host;
        const qrUrl = `${protocol}://${host}/registrar/${aluno.uuid}`;
        const qrBuffer = await qrcode.toBuffer(qrUrl, {
            type: 'png',
            width: 500,
            margin: 1,
        });

        const slug = aluno.nome_completo
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .toLowerCase() || 'aluno';

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="qrcode-${slug}.png"`);
        res.send(qrBuffer);
    } catch (error) {
        console.error('Erro ao gerar QR Code:', error);
        res.status(500).render('erro', {
            mensagem: 'Não foi possível gerar o QR Code no momento. Tente novamente mais tarde.',
        });
    }
});

app.get('/registrar/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        const data = await db.readDB();
        const alunos = Array.isArray(data.alunos) ? data.alunos : [];
        const registros = Array.isArray(data.registros) ? data.registros : [];

        const aluno = alunos.find((registro) => registro.uuid === uuid);
        if (!aluno) {
            return res.status(404).render('status', {
                Nome: 'Visitante',
                Mensagem: 'QR Code inválido ou não encontrado.',
                Horario: null,
                Redirecionar: false,
                URLDestino: null,
            });
        }

        const registroExistente = registros.find((registro) => registro.uuid === uuid);
        if (registroExistente) {
            return res.render('status', {
                Nome: aluno.nome_completo,
                Mensagem: 'Sua presença já havia sido confirmada anteriormente.',
                Horario: formatDate(registroExistente.confirmado_em),
                Redirecionar: false,
                URLDestino: null,
            });
        }

        const confirmadoEm = new Date().toISOString();
        registros.push({
            uuid,
            nome: aluno.nome_completo,
            matricula: aluno.matricula,
            confirmado_em: confirmadoEm,
        });

        data.registros = registros;
        await db.writeDB(data);

        res.render('status', {
            Nome: aluno.nome_completo,
            Mensagem: 'Presença confirmada com sucesso! Aproveite o evento.',
            Horario: formatDate(confirmadoEm),
            Redirecionar: false,
            URLDestino: null,
        });
    } catch (error) {
        console.error('Erro ao registrar presença:', error);
        res.status(500).render('erro', {
            mensagem: 'Não foi possível registrar sua presença. Tente novamente em alguns instantes.',
        });
    }
});

const privateKeyPath = '/etc/letsencrypt/live/simposio.devlima.wtf/privkey.pem';
const certificatePath = '/etc/letsencrypt/live/simposio.devlima.wtf/fullchain.pem';

if (!fs.existsSync(privateKeyPath) || !fs.existsSync(certificatePath)) {
    console.error('ERRO: Arquivos de certificado SSL não encontrados.');
    console.error('Execute o Certbot primeiro: sudo certbot certonly --standalone -d simposio.devlima.wtf');
    process.exit(1);
}

const httpsOptions = {
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(certificatePath),
};

const httpsServer = https.createServer(httpsOptions, app);
httpsServer.listen(443, () => {
    console.log('Servidor HTTPS rodando na porta 443');
});

const httpServer = http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
});
httpServer.listen(80, () => {
    console.log('Servidor HTTP rodando na porta 80 (para redirecionamento)');
});
