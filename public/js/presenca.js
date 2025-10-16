const titulo = document.querySelector('#titulo');
const descricao = document.querySelector('#descricao');
const detalhes = document.querySelector('.detalhes');
const nomeElemento = document.querySelector('#alunoNome');
const matriculaElemento = document.querySelector('#alunoMatricula');
const totalSessoesElemento = document.querySelector('#totalSessoes');
const ultimaEntradaElemento = document.querySelector('#ultimaEntrada');
const ultimaSaidaElemento = document.querySelector('#ultimaSaida');
const historicoSection = document.querySelector('#historico');
const listaSessoesElemento = document.querySelector('#listaSessoes');
const botaoConfirmar = document.querySelector('#confirmarPresenca');
const feedback = document.querySelector('#feedback');

const slug = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '').trim();

function formatarData(iso) {
    if (!iso) return '—';

    try {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(iso));
    } catch (error) {
        return '—';
    }
}

function renderHistorico(sessoes) {
    listaSessoesElemento.innerHTML = '';

    if (!Array.isArray(sessoes) || sessoes.length === 0) {
        historicoSection.hidden = true;
        return;
    }

    historicoSection.hidden = false;

    const itens = [...sessoes].reverse();

    for (const sessao of itens) {
        const item = document.createElement('li');
        item.classList.add('sessao-item');

        const estaFinalizada = sessao.saida?.confirmado;
        const emAndamento = sessao.entrada?.confirmado && !estaFinalizada;

        if (estaFinalizada) {
            item.classList.add('finalizada');
        } else if (emAndamento) {
            item.classList.add('aberta');
        } else {
            item.classList.add('pendente');
        }

        const cabecalho = document.createElement('div');
        cabecalho.classList.add('sessao-header');

        const indice = document.createElement('span');
        indice.classList.add('sessao-indice');
        indice.textContent = `Sessão ${sessao.indice}`;

        const status = document.createElement('span');
        status.classList.add('sessao-status');
        status.textContent = estaFinalizada
            ? 'Finalizada'
            : emAndamento
            ? 'Em andamento'
            : 'Pendente';

        cabecalho.appendChild(indice);
        cabecalho.appendChild(status);

        const detalhesLinha = document.createElement('div');
        detalhesLinha.classList.add('sessao-detalhes');

        const chegada = document.createElement('span');
        chegada.innerHTML = `Chegada: <strong>${formatarData(
            sessao.entrada?.confirmado_em ?? null
        )}</strong>`;

        const saida = document.createElement('span');
        saida.innerHTML = `Saída: <strong>${formatarData(sessao.saida?.confirmado_em ?? null)}</strong>`;

        const permanencia = document.createElement('span');
        const permanenciaFormatada =
            typeof sessao.permanenciaFormatada === 'string'
                ? sessao.permanenciaFormatada
                : '—';
        permanencia.innerHTML = `Permanência: <strong>${permanenciaFormatada}</strong>`;

        detalhesLinha.appendChild(chegada);
        detalhesLinha.appendChild(saida);
        detalhesLinha.appendChild(permanencia);

        item.appendChild(cabecalho);
        item.appendChild(detalhesLinha);

        listaSessoesElemento.appendChild(item);
    }
}

function atualizarResumo(presenca) {
    const totalSessoes = presenca?.totalSessoes ?? 0;
    totalSessoesElemento.textContent = totalSessoes.toString();
    ultimaEntradaElemento.textContent = formatarData(presenca?.ultimaEntrada ?? null);
    ultimaSaidaElemento.textContent = formatarData(presenca?.ultimaSaida ?? null);
    renderHistorico(presenca?.sessoes ?? []);
}

function atualizarStatus(presenca, { ocultarSaida = false } = {}) {
    atualizarResumo(presenca);

    const proximaAcao = presenca?.proximaAcao ?? 'entrada';

    if (proximaAcao === 'entrada') {
        botaoConfirmar.hidden = false;
        botaoConfirmar.disabled = false;
        botaoConfirmar.dataset.acao = 'entrada';
        botaoConfirmar.textContent = 'Confirmar chegada';
        titulo.textContent = 'Registrar chegada';
        descricao.textContent =
            'Confirme a chegada do participante para iniciar uma nova sessão no 1º Simpósio LAROI 2025.';
    } else if (proximaAcao === 'saida') {
        botaoConfirmar.dataset.acao = 'saida';

        if (ocultarSaida) {
            botaoConfirmar.hidden = true;
            botaoConfirmar.disabled = false;
            titulo.textContent = 'Chegada confirmada';
            descricao.textContent =
                'Perfeito! Quando o participante estiver saindo, leia novamente o QR Code para registrar a saída.';
        } else {
            botaoConfirmar.hidden = false;
            botaoConfirmar.disabled = false;
            botaoConfirmar.textContent = 'Confirmar saída';
            titulo.textContent = 'Registrar saída';
            descricao.textContent =
                'Finalize a participação desta sessão registrando a saída do participante.';
        }
    }
}

function exibirFeedback(tipo, mensagem) {
    feedback.textContent = mensagem;
    feedback.classList.remove('sucesso', 'erro');

    if (tipo) {
        feedback.classList.add(tipo);
    }
}

async function carregarAluno() {
    if (!slug) {
        window.location.href = '/404';
        return;
    }

    try {
        const resposta = await fetch(`/api/presencas/${slug}`);

        if (!resposta.ok) {
            throw new Error('Aluno não encontrado.');
        }

        const dados = await resposta.json();

        detalhes.hidden = false;
        nomeElemento.textContent = dados.nome_completo;
        matriculaElemento.textContent = dados.matricula;
        atualizarStatus(dados.presenca);
    } catch (error) {
        console.error(error);
        titulo.textContent = 'Ops!';
        descricao.textContent = 'QR Code inválido ou não encontrado.';
        botaoConfirmar.hidden = true;
        detalhes.hidden = true;
        historicoSection.hidden = true;
        exibirFeedback('erro', 'Verifique se você escaneou o QR Code correto.');
    }
}

botaoConfirmar.addEventListener('click', async () => {
    const acaoAtual = botaoConfirmar.dataset.acao === 'saida' ? 'saida' : 'entrada';
    const rotuloAcao = acaoAtual === 'saida' ? 'saída' : 'chegada';

    botaoConfirmar.disabled = true;
    exibirFeedback(null, `Registrando ${rotuloAcao}…`);

    try {
        const resposta = await fetch(`/api/presencas/${slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            exibirFeedback('erro', dados.erro || `Não foi possível registrar a ${rotuloAcao}.`);
            botaoConfirmar.disabled = false;
            return;
        }

        const registrandoSaida = acaoAtual === 'saida';
        atualizarStatus(dados.presenca, { ocultarSaida: !registrandoSaida });

        const mensagemSucesso =
            dados.mensagem ||
            (registrandoSaida
                ? 'Saída registrada com sucesso!'
                : 'Chegada registrada! Leia o QR Code novamente ao final para registrar a saída.');

        exibirFeedback('sucesso', mensagemSucesso);

        if (registrandoSaida) {
            botaoConfirmar.disabled = false;
        }
    } catch (error) {
        console.error(error);
        exibirFeedback('erro', `Não foi possível registrar a ${rotuloAcao} agora.`);
        botaoConfirmar.disabled = false;
    }
});

carregarAluno();
