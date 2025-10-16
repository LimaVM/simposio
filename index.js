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

const scannerAuth = basicAuth({
    users: { devlima: 'devlima' },
    challenge: true,
    realm: 'ScannerPanel',
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
    let totalEntradas = 0;
    let totalSaidas = 0;
    let alunosComEntrada = 0;
    let alunosComSaida = 0;
    let sessoesAbertas = 0;
    const permanenciasMs = [];
    let permanenciaTotalMs = 0;
    let primeiraEntrada = null;
    let ultimaSaida = null;

    for (const registro of registros) {
        const sessoes = Array.isArray(registro.sessoes) ? registro.sessoes : [];
        let possuiEntrada = false;
        let possuiSaida = false;

        for (const sessao of sessoes) {
            const entrada = sessao.entrada_confirmada_em || null;
            const saida = sessao.saida_confirmada_em || null;

            if (entrada) {
                possuiEntrada = true;
                totalEntradas += 1;

                const entradaDate = new Date(entrada);
                if (!primeiraEntrada || entradaDate < primeiraEntrada) {
                    primeiraEntrada = entradaDate;
                }
            }

            if (entrada && !saida) {
                sessoesAbertas += 1;
            }

            if (saida) {
                possuiSaida = true;
                totalSaidas += 1;

                const saidaDate = new Date(saida);
                if (!ultimaSaida || saidaDate > ultimaSaida) {
                    ultimaSaida = saidaDate;
                }
            }

            const permanenciaMs = calcularDuracaoMs(entrada, saida);
            if (permanenciaMs) {
                permanenciasMs.push(permanenciaMs);
                permanenciaTotalMs += permanenciaMs;
            }
        }

        if (possuiEntrada) {
            alunosComEntrada += 1;
        }

        if (possuiSaida) {
            alunosComSaida += 1;
        }
    }

    const pendentes = Math.max(totalAlunos - alunosComEntrada, 0);
    const apenasEntrada = Math.max(alunosComEntrada - alunosComSaida, 0);
    const taxaEntrada = totalAlunos > 0 ? alunosComEntrada / totalAlunos : 0;
    const taxaSaida = totalAlunos > 0 ? alunosComSaida / totalAlunos : 0;

    const mediaPermanenciaMs =
        permanenciasMs.length > 0
            ? permanenciasMs.reduce((acc, valor) => acc + valor, 0) / permanenciasMs.length
            : 0;

    return {
        totalAlunos,
        totalEntradas,
        totalSaidas,
        alunosComEntrada,
        alunosComSaida,
        sessoesAbertas,
        pendentes,
        apenasEntrada,
        taxaEntrada,
        taxaSaida,
        mediaPermanenciaMs,
        mediaPermanenciaFormatada: formatDuration(mediaPermanenciaMs),
        permanenciaTotalMs,
        permanenciaTotalFormatada: formatDuration(permanenciaTotalMs),
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
            const presenca = buildPresencaStatus(registro);

            return {
                nome: aluno.nome_completo,
                matricula: aluno.matricula,
                slug: aluno.slug,
                link: `${baseUrl}/${aluno.slug}`,
                totalSessoes: presenca.totalSessoes,
                totalEntradas: presenca.totalEntradas,
                totalSaidas: presenca.totalSaidas,
                ultimaEntrada: presenca.ultimaEntrada,
                ultimaSaida: presenca.ultimaSaida,
                permanenciaTotalMs: presenca.permanenciaTotalMs,
                permanenciaTotalFormatada: formatDuration(presenca.permanenciaTotalMs),
                ultimaEntradaFormatada: formatDateTimeHuman(presenca.ultimaEntrada),
                ultimaSaidaFormatada: formatDateTimeHuman(presenca.ultimaSaida),
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

function normalizarSessao(sessao) {
    if (!sessao || typeof sessao !== 'object') {
        return null;
    }

    const entrada = formatDate(
        sessao.entrada_confirmada_em || sessao.entrada || sessao.confirmado_em || null
    );
    const saida = formatDate(sessao.saida_confirmada_em || sessao.saida || null);

    if (!entrada && !saida) {
        return null;
    }

    return {
        entrada_confirmada_em: entrada,
        saida_confirmada_em: saida,
    };
}

function normalizarRegistro(registro) {
    if (!registro || typeof registro !== 'object') {
        return null;
    }

    const sessoes = [];

    if (Array.isArray(registro.sessoes) && registro.sessoes.length > 0) {
        for (const sessao of registro.sessoes) {
            const normalizada = normalizarSessao(sessao);

            if (normalizada) {
                sessoes.push(normalizada);
            }
        }
    } else {
        const entrada = formatDate(registro.entrada_confirmada_em || registro.confirmado_em || null);
        const saida = formatDate(registro.saida_confirmada_em || null);

        if (entrada || saida) {
            sessoes.push({
                entrada_confirmada_em: entrada,
                saida_confirmada_em: saida,
            });
        }
    }

    sessoes.sort((a, b) => {
        const aTime = a.entrada_confirmada_em ? new Date(a.entrada_confirmada_em).getTime() : 0;
        const bTime = b.entrada_confirmada_em ? new Date(b.entrada_confirmada_em).getTime() : 0;
        return aTime - bTime;
    });

    return {
        uuid: registro.uuid,
        nome: registro.nome || registro.nome_completo || null,
        matricula: registro.matricula || null,
        slug: registro.slug,
        sessoes,
    };
}

function mapSessaoDetalhada(sessao, indice) {
    const entrada = sessao?.entrada_confirmada_em || null;
    const saida = sessao?.saida_confirmada_em || null;
    const permanenciaMs = calcularDuracaoMs(entrada, saida);

    return {
        indice,
        entrada: {
            confirmado: Boolean(entrada),
            confirmado_em: entrada,
        },
        saida: {
            confirmado: Boolean(saida),
            confirmado_em: saida,
        },
        permanenciaMs,
        permanenciaFormatada: formatDuration(permanenciaMs),
    };
}

function buildPresencaStatus(registro) {
    const sessoesBrutas = Array.isArray(registro?.sessoes) ? registro.sessoes : [];
    const sessoes = sessoesBrutas.map((sessao, index) => mapSessaoDetalhada(sessao, index + 1));

    const ultimaEntrada = (() => {
        for (let i = sessoes.length - 1; i >= 0; i -= 1) {
            const entrada = sessoes[i].entrada.confirmado_em;
            if (entrada) {
                return entrada;
            }
        }
        return null;
    })();

    const ultimaSaida = (() => {
        for (let i = sessoes.length - 1; i >= 0; i -= 1) {
            const saida = sessoes[i].saida.confirmado_em;
            if (saida) {
                return saida;
            }
        }
        return null;
    })();

    const ultimaSessao = sessoes[sessoes.length - 1] ?? null;
    const sessaoAberta = Boolean(
        ultimaSessao && ultimaSessao.entrada.confirmado && !ultimaSessao.saida.confirmado
    );
    const proximaAcao = sessaoAberta ? 'saida' : 'entrada';

    const totalEntradas = sessoes.reduce(
        (acc, sessao) => acc + (sessao.entrada.confirmado ? 1 : 0),
        0
    );
    const totalSaidas = sessoes.reduce((acc, sessao) => acc + (sessao.saida.confirmado ? 1 : 0), 0);
    const permanenciaTotalMs = sessoes.reduce(
        (acc, sessao) => acc + (Number.isFinite(sessao.permanenciaMs) ? sessao.permanenciaMs : 0),
        0
    );

    const ultimaAtualizacao = (() => {
        let maior = null;

        for (const sessao of sessoes) {
            const valores = [sessao.entrada.confirmado_em, sessao.saida.confirmado_em]
                .filter(Boolean)
                .map((valor) => new Date(valor));

            for (const data of valores) {
                if (!maior || data > maior) {
                    maior = data;
                }
            }
        }

        return maior ? maior.toISOString() : null;
    })();

    return {
        sessoes,
        totalSessoes: sessoes.length,
        totalEntradas,
        totalSaidas,
        sessaoAberta,
        proximaAcao,
        ultimaEntrada,
        ultimaSaida,
        ultimaAtualizacao,
        permanenciaTotalMs,
        permanenciaTotalFormatada: formatDuration(permanenciaTotalMs),
    };
}

function buildAlunoResponse(aluno, registrosMap) {
    const registro = registrosMap.get(aluno.uuid);

    return {
        uuid: aluno.uuid,
        slug: aluno.slug,
        nome_completo: aluno.nome_completo,
        matricula: aluno.matricula,
        criado_em: aluno.criado_em,
        presenca: buildPresencaStatus(registro),
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

    const registrosNormalizados = registrosOriginais
        .map((registro) => {
            const normalizado = normalizarRegistro(registro);

            if (!normalizado) {
                registrosAtualizados = true;
                return null;
            }

            const sessoesOriginais = Array.isArray(registro.sessoes)
                ? registro.sessoes
                : [
                      {
                          entrada_confirmada_em:
                              registro.entrada_confirmada_em || registro.confirmado_em || null,
                          saida_confirmada_em: registro.saida_confirmada_em || null,
                      },
                  ];

            const normalizadas = normalizado.sessoes;

            const precisaAtualizar =
                !Array.isArray(registro.sessoes) ||
                sessoesOriginais.length !== normalizadas.length ||
                normalizadas.some((sessao, index) => {
                    const original = sessoesOriginais[index] || {};
                    const entradaOriginal = formatDate(
                        original.entrada_confirmada_em ||
                            original.entrada ||
                            original.confirmado_em ||
                            null
                    );
                    const saidaOriginal = formatDate(original.saida_confirmada_em || original.saida || null);

                    return (
                        sessao.entrada_confirmada_em !== entradaOriginal ||
                        sessao.saida_confirmada_em !== saidaOriginal
                    );
                });

            if (precisaAtualizar) {
                registrosAtualizados = true;
            }

            return normalizado;
        })
        .filter(Boolean);

    data.registros = registrosNormalizados;

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
            data.registros.map((registro) => [registro.uuid, registro])
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
        const baseUrl = getBaseUrl(req);
        const relatorio = buildRelatorioDados(data.alunos, data.registros, baseUrl);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Painel LAROI';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('Relatório');

        sheet.columns = [
            { header: 'Nome', key: 'nome', width: 32 },
            { header: 'Matrícula', key: 'matricula', width: 16 },
            { header: 'Sessões', key: 'sessoes', width: 12 },
            { header: 'Chegadas', key: 'entradas', width: 12 },
            { header: 'Saídas', key: 'saidas', width: 12 },
            { header: 'Última chegada', key: 'ultimaEntrada', width: 22 },
            { header: 'Última saída', key: 'ultimaSaida', width: 22 },
            { header: 'Permanência total', key: 'permanencia', width: 20 },
            { header: 'Link', key: 'link', width: 45 },
        ];

        sheet.addRow(['Resumo do evento', '', '', '', '', '', '', '', '']);
        sheet.addRow([
            'Total de alunos',
            relatorio.resumo.totalAlunos,
            'Alunos com chegada',
            relatorio.resumo.alunosComEntrada,
            'Alunos com saída',
            relatorio.resumo.alunosComSaida,
            'Gerado em',
            formatDateTimeHuman(relatorio.resumo.geradoEm),
            '',
        ]);
        sheet.addRow([
            'Total de entradas',
            relatorio.resumo.totalEntradas,
            'Total de saídas',
            relatorio.resumo.totalSaidas,
            'Sessões em andamento',
            relatorio.resumo.sessoesAbertas,
            'Permanência total',
            relatorio.resumo.permanenciaTotalFormatada,
            '',
        ]);
        sheet.addRow([
            'Pendentes',
            relatorio.resumo.pendentes,
            'Somente chegada',
            relatorio.resumo.apenasEntrada,
            'Média de permanência',
            relatorio.resumo.mediaPermanenciaFormatada,
            '',
            '',
            '',
        ]);
        sheet.addRow([
            'Taxa de presença',
            `${(relatorio.resumo.taxaEntrada * 100).toFixed(1)}%`,
            'Taxa de saída',
            `${(relatorio.resumo.taxaSaida * 100).toFixed(1)}%`,
            'Primeira chegada',
            formatDateTimeHuman(relatorio.resumo.primeiraEntrada),
            'Última saída',
            formatDateTimeHuman(relatorio.resumo.ultimaSaida),
            '',
        ]);
        sheet.addRow([]);

        const headerRow = sheet.addRow(sheet.columns.map((column) => column.header));
        headerRow.font = { bold: true };

        for (const detalhe of relatorio.detalhes) {
            sheet.addRow({
                nome: detalhe.nome,
                matricula: detalhe.matricula,
                sessoes: detalhe.totalSessoes,
                entradas: detalhe.totalEntradas,
                saidas: detalhe.totalSaidas,
                ultimaEntrada: detalhe.ultimaEntradaFormatada,
                ultimaSaida: detalhe.ultimaSaidaFormatada,
                permanencia: detalhe.permanenciaTotalFormatada,
                link: detalhe.link,
            });
        }

        sheet.autoFilter = {
            from: { row: headerRow.number, column: 1 },
            to: { row: headerRow.number + relatorio.detalhes.length, column: 9 },
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
        const baseUrl = getBaseUrl(req);
        const relatorio = buildRelatorioDados(data.alunos, data.registros, baseUrl);

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
            `Alunos com chegada: ${resumo.alunosComEntrada}`,
            `Alunos com saída: ${resumo.alunosComSaida}`,
            `Entradas registradas: ${resumo.totalEntradas}`,
            `Saídas registradas: ${resumo.totalSaidas}`,
            `Sessões em andamento: ${resumo.sessoesAbertas}`,
            `Pendentes (sem chegada): ${resumo.pendentes}`,
            `Somente chegada: ${resumo.apenasEntrada}`,
            `Taxa de presença: ${(resumo.taxaEntrada * 100).toFixed(1)}%`,
            `Taxa de saída: ${(resumo.taxaSaida * 100).toFixed(1)}%`,
            `Média de permanência por sessão: ${resumo.mediaPermanenciaFormatada}`,
            `Permanência total acumulada: ${resumo.permanenciaTotalFormatada}`,
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
            doc.text(
                `Sessões: ${detalhe.totalSessoes} · Chegadas: ${detalhe.totalEntradas} · Saídas: ${detalhe.totalSaidas}`
            );
            doc.text(`Última chegada: ${detalhe.ultimaEntradaFormatada}`);
            doc.text(`Última saída: ${detalhe.ultimaSaidaFormatada}`);
            doc.text(`Permanência total: ${detalhe.permanenciaTotalFormatada}`);
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

app.use('/api/presencas', scannerAuth);

app.get('/api/presencas/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const data = await readDatabase();
        const aluno = data.alunos.find((registro) => registro.slug === slug);

        if (!aluno) {
            return res.status(404).json({ erro: 'QR Code inválido ou não encontrado.' });
        }

        res.json({
            nome_completo: aluno.nome_completo,
            matricula: aluno.matricula,
            slug: aluno.slug,
            presenca: buildPresencaStatus(
                data.registros.find((item) => item.uuid === aluno.uuid) ?? null
            ),
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

        const agora = new Date().toISOString();
        const agoraFormatado = formatDate(agora);
        const registros = data.registros;
        let registro = registros.find((item) => item.uuid === aluno.uuid);

        if (!registro) {
            registro = {
                uuid: aluno.uuid,
                nome: aluno.nome_completo,
                matricula: aluno.matricula,
                slug: aluno.slug,
                sessoes: [],
            };

            registros.push(registro);
        } else if (!Array.isArray(registro.sessoes)) {
            registro.sessoes = [];
        }

        const sessoes = registro.sessoes;
        const ultimaSessao = sessoes[sessoes.length - 1];

        if (!ultimaSessao || ultimaSessao.saida_confirmada_em) {
            sessoes.push({
                entrada_confirmada_em: agoraFormatado,
                saida_confirmada_em: null,
            });

            await db.writeDB(data);

            return res.status(201).json({
                mensagem: 'Entrada registrada com sucesso! Aproveite o evento.',
                presenca: buildPresencaStatus(registro),
            });
        }

        ultimaSessao.saida_confirmada_em = agoraFormatado;
        await db.writeDB(data);

        return res.json({
            mensagem: 'Saída registrada. Até a próxima!',
            presenca: buildPresencaStatus(registro),
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

    return scannerAuth(req, res, () => {
        res.sendFile(path.join(__dirname, 'public', 'presenca.html'));
    });
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
