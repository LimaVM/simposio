const titulo = document.querySelector('#titulo');
const descricao = document.querySelector('#descricao');
const detalhes = document.querySelector('.detalhes');
const nomeElemento = document.querySelector('#alunoNome');
const matriculaElemento = document.querySelector('#alunoMatricula');
const statusEntradaElemento = document.querySelector('#statusEntrada');
const statusSaidaElemento = document.querySelector('#statusSaida');
const botaoConfirmar = document.querySelector('#confirmarPresenca');
const feedback = document.querySelector('#feedback');

const slug = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '').trim();

function formatarData(iso) {
    if (!iso) return null;

    try {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(iso));
    } catch (error) {
        return null;
    }
}

function atualizarStatus(presenca, { ocultarSaida = false } = {}) {
    const entradaConfirmada = presenca?.entrada?.confirmado ?? false;
    const saidaConfirmada = presenca?.saida?.confirmado ?? false;

    const entradaData = formatarData(presenca?.entrada?.confirmado_em ?? null);
    const saidaData = formatarData(presenca?.saida?.confirmado_em ?? null);

    statusEntradaElemento.textContent = entradaConfirmada
        ? entradaData ?? 'Registrada'
        : 'Pendente';
    statusSaidaElemento.textContent = saidaConfirmada ? saidaData ?? 'Registrada' : 'Pendente';

    statusEntradaElemento.classList.toggle('confirmada', entradaConfirmada);
    statusEntradaElemento.classList.toggle('pendente', !entradaConfirmada);
    statusSaidaElemento.classList.toggle('confirmada', saidaConfirmada);
    statusSaidaElemento.classList.toggle('pendente', !saidaConfirmada);

    if (!entradaConfirmada) {
        botaoConfirmar.hidden = false;
        botaoConfirmar.disabled = false;
        botaoConfirmar.textContent = 'Confirmar chegada';
        titulo.textContent = 'Confirme sua presença';
        descricao.textContent =
            'Confira seus dados e finalize a confirmação para aproveitar todas as experiências do 1º Simpósio LAROI 2025.';
    } else if (!saidaConfirmada) {
        if (ocultarSaida) {
            botaoConfirmar.hidden = true;
            titulo.textContent = 'Chegada confirmada';
            descricao.textContent = 'Tudo certo! Ao sair, escaneie o mesmo QR Code para registrar sua saída.';
        } else {
            botaoConfirmar.hidden = false;
            botaoConfirmar.disabled = false;
            botaoConfirmar.textContent = 'Confirmar saída';
            titulo.textContent = 'Tudo pronto para encerrar o dia?';
            descricao.textContent = 'Registre sua saída para concluirmos sua participação no 1º Simpósio LAROI 2025.';
        }
    } else {
        botaoConfirmar.hidden = true;
        titulo.textContent = 'Participação registrada';
        descricao.textContent =
            'Sua chegada e saída foram confirmadas. Obrigado por participar do 1º Simpósio LAROI 2025!';
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
        exibirFeedback('erro', 'Verifique se você escaneou o QR Code correto.');
    }
}

botaoConfirmar.addEventListener('click', async () => {
    const acaoAtual = botaoConfirmar.textContent.toLowerCase().includes('saída')
        ? 'saída'
        : 'chegada';

    botaoConfirmar.disabled = true;
    exibirFeedback(null, `Registrando ${acaoAtual}…`);

    try {
        const resposta = await fetch(`/api/presencas/${slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            exibirFeedback('erro', dados.erro || `Não foi possível registrar sua ${acaoAtual}.`);
            botaoConfirmar.disabled = false;
            return;
        }

        const registrandoSaida = acaoAtual === 'saída';
        atualizarStatus(dados.presenca, { ocultarSaida: !registrandoSaida });

        const mensagemSucesso = dados.mensagem
            || (registrandoSaida
                ? 'Saída confirmada com sucesso!'
                : 'Chegada confirmada! Escaneie novamente o QR Code ao sair para registrar a saída.');

        exibirFeedback('sucesso', mensagemSucesso);

        if (registrandoSaida) {
            botaoConfirmar.disabled = false;
        }
    } catch (error) {
        console.error(error);
        exibirFeedback('erro', `Não foi possível registrar sua ${acaoAtual} agora.`);
        botaoConfirmar.disabled = false;
    }
});

carregarAluno();
