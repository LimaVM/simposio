const tableBody = document.querySelector('#alunosTable');
const rowTemplate = document.querySelector('#alunoRow');
const emptyState = document.querySelector('#emptyState');
const alertBox = document.querySelector('.alert');
const registerForm = document.querySelector('#registerForm');
const searchInput = document.querySelector('#buscar');
const refreshButton = document.querySelector('#refreshButton');
const exportButtons = document.querySelectorAll('[data-export]');

let alunosCache = [];

function formatDate(isoString) {
    if (!isoString) {
        return 'Pendente';
    }

    try {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(isoString));
    } catch (error) {
        return 'Pendente';
    }
}

function showAlert(type, message) {
    if (!alertBox) {
        return;
    }

    alertBox.textContent = message;
    alertBox.classList.remove('success', 'error');
    alertBox.hidden = false;

    if (type) {
        alertBox.classList.add(type);
    }

    clearTimeout(showAlert.timeoutId);
    showAlert.timeoutId = setTimeout(() => {
        alertBox.hidden = true;
    }, 6000);
}

function createLink(host, slug) {
    const base = `${window.location.protocol}//${host}`;
    return `${base}/${slug}`;
}

function renderAlunos(list) {
    tableBody.innerHTML = '';

    if (list.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    const host = window.location.host;

    for (const aluno of list) {
        const row = rowTemplate.content.firstElementChild.cloneNode(true);
        const url = createLink(host, aluno.slug);
        const nomeCell = row.querySelector('.nome');
        const matriculaCell = row.querySelector('.matricula');
        const sessoesCell = row.querySelector('.sessoes');
        const chegadaCell = row.querySelector('.entrada');
        const saidaCell = row.querySelector('.saida');
        const linkWrapper = row.querySelector('.link');
        const linkAnchor = linkWrapper.querySelector('a');
        const copyButton = linkWrapper.querySelector('[data-action="copy"]');
        const qrWrapper = row.querySelector('.qrcode');
        const qrAnchor = qrWrapper.querySelector('a');

        nomeCell.textContent = aluno.nome_completo;
        matriculaCell.textContent = aluno.matricula;
        sessoesCell.innerHTML = '';
        chegadaCell.innerHTML = '';
        saidaCell.innerHTML = '';

        const presenca = aluno.presenca ?? {};
        const totalSessoes = presenca.totalSessoes ?? 0;
        const totalEntradas = presenca.totalEntradas ?? 0;
        const totalSaidas = presenca.totalSaidas ?? 0;
        const sessoesEmAndamento = Math.max(totalEntradas - totalSaidas, 0);

        const sessoesBadge = document.createElement('span');
        sessoesBadge.classList.add('status-badge', totalSessoes > 0 ? 'confirmada' : 'pendente');
        sessoesBadge.textContent = `${totalSessoes} sessão${totalSessoes === 1 ? '' : 's'}`;
        sessoesCell.appendChild(sessoesBadge);

        if (sessoesEmAndamento > 0) {
            const andamentoBadge = document.createElement('span');
            andamentoBadge.classList.add('status-chip', 'aberta');
            andamentoBadge.textContent = `${sessoesEmAndamento} em andamento`;
            sessoesCell.appendChild(andamentoBadge);
        }

        const entradaBadge = document.createElement('span');
        entradaBadge.classList.add(
            'status-badge',
            presenca.ultimaEntrada ? 'confirmada' : 'pendente'
        );
        entradaBadge.textContent = formatDate(presenca.ultimaEntrada);

        const entradaMeta = document.createElement('small');
        entradaMeta.classList.add('status-meta');
        entradaMeta.textContent = `${totalEntradas} chegada${totalEntradas === 1 ? '' : 's'}`;

        const entradaWrapper = document.createElement('div');
        entradaWrapper.classList.add('status-block');
        entradaWrapper.appendChild(entradaBadge);
        entradaWrapper.appendChild(entradaMeta);

        const saidaBadge = document.createElement('span');
        saidaBadge.classList.add('status-badge', presenca.ultimaSaida ? 'confirmada' : 'pendente');
        saidaBadge.textContent = formatDate(presenca.ultimaSaida);

        const saidaMeta = document.createElement('small');
        saidaMeta.classList.add('status-meta');
        saidaMeta.textContent = `${totalSaidas} saída${totalSaidas === 1 ? '' : 's'}`;

        const saidaWrapper = document.createElement('div');
        saidaWrapper.classList.add('status-block');
        saidaWrapper.appendChild(saidaBadge);
        saidaWrapper.appendChild(saidaMeta);

        if (presenca.sessaoAberta) {
            const alertaSaida = document.createElement('small');
            alertaSaida.classList.add('status-meta', 'alerta');
            alertaSaida.textContent = 'Aguardando saída';
            saidaWrapper.appendChild(alertaSaida);
        }

        chegadaCell.appendChild(entradaWrapper);
        saidaCell.appendChild(saidaWrapper);

        linkAnchor.textContent = 'Abrir link';
        linkAnchor.href = url;

        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(url);
                showAlert('success', 'Link copiado para a área de transferência.');
            } catch (error) {
                showAlert('error', 'Não foi possível copiar o link, copie manualmente.');
            }
        });

        qrAnchor.href = `/api/admin/qrcode/${aluno.slug}`;
        qrAnchor.setAttribute('download', `qrcode-${aluno.slug}.png`);

        if (window.innerWidth <= 640) {
            nomeCell.dataset.label = 'Nome';
            matriculaCell.dataset.label = 'Matrícula';
            sessoesCell.dataset.label = 'Sessões';
            chegadaCell.dataset.label = 'Chegada';
            saidaCell.dataset.label = 'Saída';
            linkWrapper.dataset.label = 'Link';
            qrWrapper.dataset.label = 'QR Code';
        } else {
            delete nomeCell.dataset.label;
            delete matriculaCell.dataset.label;
            delete sessoesCell.dataset.label;
            delete chegadaCell.dataset.label;
            delete saidaCell.dataset.label;
            delete linkWrapper.dataset.label;
            delete qrWrapper.dataset.label;
        }

        tableBody.appendChild(row);
    }
}

function filterAlunos(query) {
    const normalised = query.trim().toLowerCase();

    if (!normalised) {
        renderAlunos(alunosCache);
        return;
    }

    const filtrados = alunosCache.filter((aluno) => {
        return (
            aluno.nome_completo.toLowerCase().includes(normalised) ||
            aluno.matricula.toLowerCase().includes(normalised) ||
            aluno.slug.toLowerCase().includes(normalised)
        );
    });

    renderAlunos(filtrados);
}

async function carregarAlunos() {
    try {
        const resposta = await fetch('/api/admin/alunos', {
            headers: { Accept: 'application/json' },
        });

        if (!resposta.ok) {
            throw new Error('Falha ao carregar alunos');
        }

        const dados = await resposta.json();
        alunosCache = dados.alunos ?? [];
        renderAlunos(alunosCache);
    } catch (error) {
        console.error(error);
        showAlert('error', 'Não foi possível carregar a lista de alunos. Tente novamente.');
    }
}

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const nome = (formData.get('nome') || '').trim();
    const matricula = (formData.get('matricula') || '').trim();

    if (!nome || !matricula) {
        showAlert('error', 'Preencha o nome completo e a matrícula.');
        return;
    }

    const payload = new URLSearchParams();
    payload.append('nome', nome);
    payload.append('matricula', matricula);

    try {
        const resposta = await fetch('/api/admin/alunos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: payload,
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            showAlert('error', dados.erro || 'Erro ao cadastrar aluno.');
            return;
        }

        showAlert('success', dados.mensagem || 'Aluno cadastrado com sucesso.');
        registerForm.reset();
        alunosCache = [...alunosCache, dados.aluno];
        alunosCache.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, 'pt-BR'));
        renderAlunos(alunosCache);
    } catch (error) {
        console.error(error);
        showAlert('error', 'Não foi possível cadastrar o aluno agora.');
    }
});

searchInput.addEventListener('input', (event) => {
    filterAlunos(event.target.value);
});

refreshButton.addEventListener('click', () => {
    carregarAlunos();
    showAlert(null, 'Lista atualizada.');
});

async function downloadRelatorio(formato) {
    const endpoints = {
        pdf: '/api/admin/relatorios/pdf',
        excel: '/api/admin/relatorios/excel',
    };

    const nomesArquivos = {
        pdf: 'relatorio-simposio-laroi.pdf',
        excel: 'relatorio-simposio-laroi.xlsx',
    };

    const endpoint = endpoints[formato];

    if (!endpoint) {
        showAlert('error', 'Formato de relatório inválido.');
        return;
    }

    try {
        const resposta = await fetch(endpoint, {
            headers: { Accept: formato === 'pdf' ? 'application/pdf' : '*/*' },
        });

        if (!resposta.ok) {
            throw new Error('Falha ao gerar relatório');
        }

        const blob = await resposta.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomesArquivos[formato] || `relatorio.${formato}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        showAlert('success', 'Relatório exportado com sucesso.');
    } catch (error) {
        console.error(error);
        showAlert('error', 'Não foi possível gerar o relatório agora.');
    }
}

exportButtons.forEach((botao) => {
    botao.addEventListener('click', () => {
        const formato = botao.dataset.export;
        downloadRelatorio(formato);
    });
});

window.addEventListener('resize', () => {
    renderAlunos(alunosCache);
});

carregarAlunos();
