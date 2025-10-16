const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const basicAuth = require('express-basic-auth');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const db = require('./json-db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

const adminAuth = basicAuth({
    users: { devlima: 'devlima' },
    challenge: true,
    realm: 'AdminPanel',
});

const RESERVED_PATHS = new Set(['', 'api', 'css', 'js', 'images', 'favicon.ico', 'robots.txt', '404']);

function formatDate(isoString) {
    if (!isoString) {
        return null;
    }

    try {
        return new Date(isoString).toISOString();
    } catch (error) {
        return null;
    }
}

function buildAlunoResponse(aluno, registrosMap) {
    const registro = registrosMap.get(aluno.uuid);

    return {
        uuid: aluno.uuid,
        slug: aluno.slug,
        nome_completo: aluno.nome_completo,
        matricula: aluno.matricula,
        criado_em: aluno.criado_em,
        presenca: {
            confirmado: Boolean(registro),
            confirmado_em: formatDate(registro?.confirmado_em ?? null),
        },
    };
}

function generateSlug(existingSlugs) {
    let slug;

    do {
        slug = crypto.randomBytes(4).toString('hex');
    } while (existingSlugs.has(slug) || RESERVED_PATHS.has(slug));

    return slug;
}

async function readDatabase() {
    const data = await db.readDB();
    const alunos = Array.isArray(data.alunos) ? data.alunos : [];
    const registros = Array.isArray(data.registros) ? data.registros : [];

    data.alunos = alunos;
    data.registros = registros;

    const existingSlugs = new Set(
        alunos.filter((aluno) => typeof aluno.slug === 'string' && aluno.slug.trim() !== '').map((aluno) => aluno.slug)
    );

    let shouldPersist = false;

    for (const aluno of alunos) {
        if (!aluno.slug) {
            aluno.slug = generateSlug(existingSlugs);
            existingSlugs.add(aluno.slug);
            shouldPersist = true;
        }
    }

    if (shouldPersist) {
        await db.writeDB(data);
    }

    return data;
}

app.get('/', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/alunos', adminAuth, async (req, res) => {
    try {
        const data = await readDatabase();
        const registrosMap = new Map(data.registros.map((registro) => [registro.uuid, registro]));

        const alunosOrdenados = [...data.alunos].sort((a, b) =>
            a.nome_completo.localeCompare(b.nome_completo, 'pt-BR')
        );

        res.json({
            alunos: alunosOrdenados.map((aluno) => buildAlunoResponse(aluno, registrosMap)),
        });
    } catch (error) {
        console.error('Erro ao listar alunos:', error);
        res.status(500).json({ erro: 'Não foi possível carregar a lista de alunos.' });
    }
});

app.post('/api/admin/alunos', adminAuth, async (req, res) => {
    const nome = req.body.nome?.trim();
    const matricula = req.body.matricula?.trim();

    if (!nome || !matricula) {
        return res.status(400).json({ erro: 'Informe o nome completo e a matrícula do aluno.' });
    }

    try {
        const data = await readDatabase();
        const registrosMap = new Map(data.registros.map((registro) => [registro.uuid, registro]));

        const matriculaJaExiste = data.alunos.some(
            (aluno) => aluno.matricula.toLowerCase() === matricula.toLowerCase()
        );

        if (matriculaJaExiste) {
            return res.status(409).json({ erro: 'Já existe um aluno cadastrado com essa matrícula.' });
        }

        const slugSet = new Set(data.alunos.map((aluno) => aluno.slug));
        const novoAluno = {
            uuid: uuidv4(),
            slug: generateSlug(slugSet),
            nome_completo: nome,
            matricula,
            criado_em: new Date().toISOString(),
        };

        data.alunos.push(novoAluno);
        await db.writeDB(data);

        res.status(201).json({
            mensagem: 'Aluno cadastrado com sucesso.',
            aluno: buildAlunoResponse(novoAluno, registrosMap),
        });
    } catch (error) {
        console.error('Erro ao cadastrar aluno:', error);
        res.status(500).json({ erro: 'Não foi possível cadastrar o aluno no momento.' });
    }
});

app.get('/api/admin/qrcode/:slug', adminAuth, async (req, res) => {
    try {
        const { slug } = req.params;
        const data = await readDatabase();
        const aluno = data.alunos.find((registro) => registro.slug === slug);

        if (!aluno) {
            return res.status(404).json({ erro: 'Aluno não encontrado para gerar o QR Code.' });
        }

        const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host = req.headers.host;
        const qrUrl = `${protocol}://${host}/${aluno.slug}`;
        const qrBuffer = await qrcode.toBuffer(qrUrl, {
            type: 'png',
            width: 500,
            margin: 1,
        });

        const slugifiedName = aluno.nome_completo
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .toLowerCase() || 'aluno';

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="qrcode-${slugifiedName}.png"`);
        res.send(qrBuffer);
    } catch (error) {
        console.error('Erro ao gerar QR Code:', error);
        res.status(500).json({ erro: 'Não foi possível gerar o QR Code no momento.' });
    }
});

app.get('/api/presencas/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const data = await readDatabase();
        const aluno = data.alunos.find((registro) => registro.slug === slug);

        if (!aluno) {
            return res.status(404).json({ erro: 'QR Code inválido ou não encontrado.' });
        }

        const registro = data.registros.find((item) => item.uuid === aluno.uuid) ?? null;

        res.json({
            nome_completo: aluno.nome_completo,
            matricula: aluno.matricula,
            slug: aluno.slug,
            presenca: {
                confirmado: Boolean(registro),
                confirmado_em: formatDate(registro?.confirmado_em ?? null),
            },
        });
    } catch (error) {
        console.error('Erro ao consultar presença:', error);
        res.status(500).json({ erro: 'Não foi possível consultar a presença no momento.' });
    }
});

app.post('/api/presencas/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const data = await readDatabase();
        const aluno = data.alunos.find((registro) => registro.slug === slug);

        if (!aluno) {
            return res.status(404).json({ erro: 'QR Code inválido ou não encontrado.' });
        }

        const registros = data.registros;
        const registroExistente = registros.find((registro) => registro.uuid === aluno.uuid);

        if (registroExistente) {
            return res.json({
                mensagem: 'Sua presença já havia sido confirmada anteriormente.',
                presenca: {
                    confirmado: true,
                    confirmado_em: formatDate(registroExistente.confirmado_em),
                },
            });
        }

        const confirmadoEm = new Date().toISOString();
        registros.push({
            uuid: aluno.uuid,
            nome: aluno.nome_completo,
            matricula: aluno.matricula,
            slug: aluno.slug,
            confirmado_em: confirmadoEm,
        });

        await db.writeDB(data);

        res.status(201).json({
            mensagem: 'Presença confirmada com sucesso! Aproveite o evento.',
            presenca: {
                confirmado: true,
                confirmado_em: formatDate(confirmadoEm),
            },
        });
    } catch (error) {
        console.error('Erro ao registrar presença:', error);
        res.status(500).json({ erro: 'Não foi possível registrar sua presença. Tente novamente em instantes.' });
    }
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow:');
});

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.get('/404', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.get('/:slug', (req, res, next) => {
    const slug = req.params.slug.toLowerCase();

    if (RESERVED_PATHS.has(slug) || slug.includes('.')) {
        return next();
    }

    res.sendFile(path.join(__dirname, 'public', 'presenca.html'));
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const defaultKeyPath = '/etc/letsencrypt/live/simposio.devlima.wtf/privkey.pem';
const defaultCertPath = '/etc/letsencrypt/live/simposio.devlima.wtf/fullchain.pem';

const privateKeyPath = process.env.SSL_KEY_PATH || defaultKeyPath;
const certificatePath = process.env.SSL_CERT_PATH || defaultCertPath;

const hasCertificates = fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath);

if (hasCertificates) {
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
} else {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.warn('Certificados SSL não encontrados. Inicializando servidor HTTP simples.');
        console.log(`Servidor HTTP rodando na porta ${port}`);
    });
}
