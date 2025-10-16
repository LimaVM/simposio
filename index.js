const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const basicAuth = require('express-basic-auth');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
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

function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    return `${protocol}://${req.headers.host}`;
}

function formatDateTimeHuman(isoString) {
    if (!isoString) {
        return '—';
    }

    try {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(isoString));
    } catch (error) {
        return '—';
    }
}

function calcularDuracaoMs(entrada, saida) {
    if (!entrada || !saida) {
        return null;
    }

    const inicio = new Date(entrada).getTime();
    const fim = new Date(saida).getTime();

    if (Number.isNaN(inicio) || Number.isNaN(fim) || fim <= inicio) {
        return null;
    }

    return fim - inicio;
}

function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return '—';
    }

    const totalMinutes = Math.round(durationMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const parts = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }

    parts.push(`${minutes}min`);

    return parts.join(' ');
}

function buildResumoRelatorio(alunos, registros) {
    const totalAlunos = alunos.length;
    let totalEntrada = 0;
    let totalSaida = 0;
    const permanenciasMs = [];
    let primeiraEntrada = null;
    let ultimaSaida = null;

    for (const registro of registros) {
        if (registro.entrada_confirmada_em) {
            totalEntrada += 1;

            const entradaDate = new Date(registro.entrada_confirmada_em);
            if (!primeiraEntrada || entradaDate < primeiraEntrada) {
                primeiraEntrada = entradaDate;
            }
        }

        if (registro.saida_confirmada_em) {
            totalSaida += 1;

            const saidaDate = new Date(registro.saida_confirmada_em);
            if (!ultimaSaida || saidaDate > ultimaSaida) {
                ultimaSaida = saidaDate;
            }
        }

        const permanenciaMs = calcularDuracaoMs(
            registro.entrada_confirmada_em,
            registro.saida_confirmada_em
        );

        if (permanenciaMs) {
            permanenciasMs.push(permanenciaMs);
        }
    }

    const pendentes = Math.max(totalAlunos - totalEntrada, 0);
    const apenasEntrada = Math.max(totalEntrada - totalSaida, 0);
    const taxaEntrada = totalAlunos > 0 ? totalEntrada / totalAlunos : 0;
    const taxaSaida = totalAlunos > 0 ? totalSaida / totalAlunos : 0;

    const mediaPermanenciaMs =
        permanenciasMs.length > 0
            ? permanenciasMs.reduce((acc, valor) => acc + valor, 0) / permanenciasMs.length
            : 0;

    return {
        totalAlunos,
        totalEntrada,
        totalSaida,
        pendentes,
        apenasEntrada,
        taxaEntrada,
        taxaSaida,
        mediaPermanenciaMs,
        mediaPermanenciaFormatada: formatDuration(mediaPermanenciaMs),
        primeiraEntrada: primeiraEntrada ? primeiraEntrada.toISOString() : null,
        ultimaSaida: ultimaSaida ? ultimaSaida.toISOString() : null,
        geradoEm: new Date().toISOString(),
    };
}

function buildRelatorioDados(alunos, registros, baseUrl) {
    const registrosMap = new Map(registros.map((registro) => [registro.uuid, registro]));

    const detalhes = alunos
        .map((aluno) => {
            const registro = registrosMap.get(aluno.uuid) ?? null;
            const entrada = registro?.entrada_confirmada_em ?? null;
            const saida = registro?.saida_confirmada_em ?? null;
            const permanenciaMs = calcularDuracaoMs(entrada, saida);

            return {
                nome: aluno.nome_completo,
                matricula: aluno.matricula,
                slug: aluno.slug,
                link: `${baseUrl}/${aluno.slug}`,
                entrada,
                saida,
                permanenciaMs,
                permanenciaFormatada: formatDuration(permanenciaMs),
                entradaFormatada: formatDateTimeHuman(entrada),
                saidaFormatada: formatDateTimeHuman(saida),
                statusEntrada: Boolean(entrada),
                statusSaida: Boolean(saida),
            };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const resumo = buildResumoRelatorio(alunos, registros);

    return { resumo, detalhes };
}

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

function normalizarRegistro(registro) {
    const entrada = registro.entrada_confirmada_em || registro.confirmado_em || null;
    const saida = registro.saida_confirmada_em || null;

    const normalizado = {
        uuid: registro.uuid,
        nome: registro.nome,
        matricula: registro.matricula,
        slug: registro.slug,
        entrada_confirmada_em: entrada ? formatDate(entrada) : null,
        saida_confirmada_em: saida ? formatDate(saida) : null,
    };

    return normalizado;
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
            entrada: {
                confirmado: Boolean(registro?.entrada_confirmada_em),
                confirmado_em: registro?.entrada_confirmada_em ?? null,
            },
            saida: {
                confirmado: Boolean(registro?.saida_confirmada_em),
                confirmado_em: registro?.saida_confirmada_em ?? null,
            },
        },
    };
}

function buildPresencaStatus(registro) {
    return {
        entrada: {
            confirmado: Boolean(registro?.entrada_confirmada_em),
            confirmado_em: registro?.entrada_confirmada_em ?? null,
        },
        saida: {
            confirmado: Boolean(registro?.saida_confirmada_em),
            confirmado_em: registro?.saida_confirmada_em ?? null,
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
    const registrosOriginais = Array.isArray(data.registros) ? data.registros : [];

    data.alunos = alunos;
    data.registros = registrosOriginais;

    const existingSlugs = new Set(
        alunos.filter((aluno) => typeof aluno.slug === 'string' && aluno.slug.trim() !== '').map((aluno) => aluno.slug)
    );

    let shouldPersist = false;
    let registrosAtualizados = false;

    for (const aluno of alunos) {
        if (!aluno.slug) {
            aluno.slug = generateSlug(existingSlugs);
            existingSlugs.add(aluno.slug);
            shouldPersist = true;
        }
    }

    const registrosNormalizados = registrosOriginais.map((registro) => {
        const normalizado = normalizarRegistro(registro);

        const entradaOriginal = formatDate(registro.entrada_confirmada_em ?? registro.confirmado_em ?? null);
        const saidaOriginal = formatDate(registro.saida_confirmada_em ?? null);
        const estruturaDiferente =
            !Object.prototype.hasOwnProperty.call(registro, 'entrada_confirmada_em') ||
            Object.prototype.hasOwnProperty.call(registro, 'confirmado_em') ||
            !Object.prototype.hasOwnProperty.call(registro, 'saida_confirmada_em');

        if (
            normalizado.entrada_confirmada_em !== entradaOriginal ||
            normalizado.saida_confirmada_em !== saidaOriginal ||
            estruturaDiferente
        ) {
            registrosAtualizados = true;
        }

        return normalizado;
    });

    if (registrosAtualizados) {
        data.registros = registrosNormalizados;
    } else {
        data.registros = registrosOriginais.map((registro) => normalizarRegistro(registro));
    }

    if (shouldPersist || registrosAtualizados) {
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
        const registrosMap = new Map(
            data.registros.map((registro) => [registro.uuid, normalizarRegistro(registro)])
        );

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

        const baseUrl = getBaseUrl(req);
        const qrUrl = `${baseUrl}/${aluno.slug}`;
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

app.get('/api/admin/relatorios/excel', adminAuth, async (req, res) => {
    try {
        const data = await readDatabase();
        const registrosNormalizados = data.registros.map((registro) => normalizarRegistro(registro));
        const baseUrl = getBaseUrl(req);
        const relatorio = buildRelatorioDados(data.alunos, registrosNormalizados, baseUrl);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Painel LAROI';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('Relatório');

        sheet.columns = [
            { header: 'Nome', key: 'nome', width: 32 },
            { header: 'Matrícula', key: 'matricula', width: 16 },
            { header: 'Chegada', key: 'entrada', width: 20 },
            { header: 'Saída', key: 'saida', width: 20 },
            { header: 'Permanência', key: 'permanencia', width: 16 },
            { header: 'Link', key: 'link', width: 45 },
        ];

        sheet.addRow(['Resumo do evento', '', '', '', '', '']);
        sheet.addRow([
            'Total de alunos',
            relatorio.resumo.totalAlunos,
            'Confirmaram chegada',
            relatorio.resumo.totalEntrada,
            'Confirmaram saída',
            relatorio.resumo.totalSaida,
        ]);
        sheet.addRow([
            'Pendentes',
            relatorio.resumo.pendentes,
            'Somente chegada',
            relatorio.resumo.apenasEntrada,
            'Média de permanência',
            relatorio.resumo.mediaPermanenciaFormatada,
        ]);
        sheet.addRow([
            'Taxa de presença',
            `${(relatorio.resumo.taxaEntrada * 100).toFixed(1)}%`,
            'Taxa de saída',
            `${(relatorio.resumo.taxaSaida * 100).toFixed(1)}%`,
            'Gerado em',
            formatDateTimeHuman(relatorio.resumo.geradoEm),
        ]);
        sheet.addRow([
            'Primeira chegada',
            formatDateTimeHuman(relatorio.resumo.primeiraEntrada),
            'Última saída',
            formatDateTimeHuman(relatorio.resumo.ultimaSaida),
            '',
            '',
        ]);
        sheet.addRow([]);

        const headerRow = sheet.addRow(sheet.columns.map((column) => column.header));
        headerRow.font = { bold: true };

        for (const detalhe of relatorio.detalhes) {
            sheet.addRow({
                nome: detalhe.nome,
                matricula: detalhe.matricula,
                entrada: detalhe.entradaFormatada,
                saida: detalhe.saidaFormatada,
                permanencia: detalhe.permanenciaFormatada,
                link: detalhe.link,
            });
        }

        sheet.autoFilter = {
            from: { row: headerRow.number, column: 1 },
            to: { row: headerRow.number + relatorio.detalhes.length, column: 6 },
        };

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="relatorio-simposio-laroi.xlsx"'
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Erro ao gerar relatório Excel:', error);
        res
            .status(500)
            .json({ erro: 'Não foi possível gerar o relatório em Excel. Tente novamente.' });
    }
});

app.get('/api/admin/relatorios/pdf', adminAuth, async (req, res) => {
    try {
        const data = await readDatabase();
        const registrosNormalizados = data.registros.map((registro) => normalizarRegistro(registro));
        const baseUrl = getBaseUrl(req);
        const relatorio = buildRelatorioDados(data.alunos, registrosNormalizados, baseUrl);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="relatorio-simposio-laroi.pdf"');

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        doc.pipe(res);

        doc.fontSize(18).fillColor('#111827').text('1º Simpósio LAROI 2025', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(12).fillColor('#374151').text('Relatório de convites e presenças', {
            align: 'center',
        });
        doc.moveDown(1);

        const resumo = relatorio.resumo;

        const resumoItens = [
            `Total de alunos: ${resumo.totalAlunos}`,
            `Confirmaram chegada: ${resumo.totalEntrada}`,
            `Confirmaram saída: ${resumo.totalSaida}`,
            `Pendentes: ${resumo.pendentes}`,
            `Somente chegada: ${resumo.apenasEntrada}`,
            `Taxa de presença: ${(resumo.taxaEntrada * 100).toFixed(1)}%`,
            `Taxa de saída: ${(resumo.taxaSaida * 100).toFixed(1)}%`,
            `Média de permanência: ${resumo.mediaPermanenciaFormatada}`,
            `Primeira chegada registrada: ${formatDateTimeHuman(resumo.primeiraEntrada)}`,
            `Última saída registrada: ${formatDateTimeHuman(resumo.ultimaSaida)}`,
        ];

        doc.fontSize(12).fillColor('#111827').text('Resumo geral', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#111827');
        resumoItens.forEach((item) => {
            doc.text(`• ${item}`);
        });

        doc.moveDown(1);
        doc.fontSize(12).fillColor('#111827').text('Detalhes por participante', { underline: true });
        doc.moveDown(0.5);

        const detalheFontSize = 10;
        doc.fontSize(detalheFontSize).fillColor('#111827');

        relatorio.detalhes.forEach((detalhe, index) => {
            doc.fontSize(11).text(`${detalhe.nome} (${detalhe.matricula})`, {
                continued: false,
            });
            doc.fontSize(detalheFontSize);
            doc.text(`Chegada: ${detalhe.entradaFormatada}`);
            doc.text(`Saída: ${detalhe.saidaFormatada}`);
            doc.text(`Permanência: ${detalhe.permanenciaFormatada}`);
            doc.text(`Link: ${detalhe.link}`, { underline: true, link: detalhe.link });

            if (index < relatorio.detalhes.length - 1) {
                doc.moveDown(0.8);
            }
        });

        doc.moveDown(1);
        doc.fontSize(10).fillColor('#6b7280').text(
            `Relatório gerado em ${formatDateTimeHuman(resumo.geradoEm)}.`
        );

        doc.end();
    } catch (error) {
        console.error('Erro ao gerar relatório PDF:', error);
        if (!res.headersSent) {
            res
                .status(500)
                .json({ erro: 'Não foi possível gerar o relatório em PDF. Tente novamente.' });
        }
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
        const registroNormalizado = registro ? normalizarRegistro(registro) : null;

        res.json({
            nome_completo: aluno.nome_completo,
            matricula: aluno.matricula,
            slug: aluno.slug,
            presenca: buildPresencaStatus(registroNormalizado),
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
        const agora = new Date().toISOString();

        if (!registroExistente) {
            const novoRegistro = {
                uuid: aluno.uuid,
                nome: aluno.nome_completo,
                matricula: aluno.matricula,
                slug: aluno.slug,
                entrada_confirmada_em: formatDate(agora),
                saida_confirmada_em: null,
            };

            registros.push(novoRegistro);
            await db.writeDB(data);

            return res.status(201).json({
                mensagem: 'Entrada registrada com sucesso! Aproveite o evento.',
                presenca: buildPresencaStatus(novoRegistro),
            });
        }

        if (!registroExistente.entrada_confirmada_em) {
            registroExistente.entrada_confirmada_em = formatDate(agora);
            await db.writeDB(data);

            return res.json({
                mensagem: 'Entrada registrada com sucesso! Aproveite o evento.',
                presenca: buildPresencaStatus(registroExistente),
            });
        }

        if (!registroExistente.saida_confirmada_em) {
            registroExistente.saida_confirmada_em = formatDate(agora);
            await db.writeDB(data);

            return res.json({
                mensagem: 'Saída registrada. Até a próxima!',
                presenca: buildPresencaStatus(registroExistente),
            });
        }

        return res.json({
            mensagem: 'Sua entrada e saída já foram registradas.',
            presenca: buildPresencaStatus(registroExistente),
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
