const titulo = document.querySelector('#titulo');
const descricao = document.querySelector('#descricao');
const detalhes = document.querySelector('.detalhes');
const nomeElemento = document.querySelector('#alunoNome');
const matriculaElemento = document.querySelector('#alunoMatricula');
const statusElemento = document.querySelector('#statusPresenca');
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

function atualizarStatus(presenca) {
    if (!presenca.confirmado) {
        statusElemento.textContent = 'Presença pendente';
        botaoConfirmar.hidden = false;
        botaoConfirmar.disabled = false;
    } else {
        const data = formatarData(presenca.confirmado_em);
        statusElemento.textContent = data ? `Presença confirmada em ${data}` : 'Presença confirmada';
        botaoConfirmar.hidden = true;
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

        titulo.textContent = 'Confirme sua presença';
        descricao.textContent =
            'Confira seus dados e finalize a confirmação para aproveitar todas as experiências do simpósio.';
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
    botaoConfirmar.disabled = true;
    exibirFeedback(null, 'Registrando presença…');

    try {
        const resposta = await fetch(`/api/presencas/${slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            exibirFeedback('erro', dados.erro || 'Não foi possível confirmar a presença.');
            botaoConfirmar.disabled = false;
            return;
        }

        atualizarStatus(dados.presenca);
        exibirFeedback('sucesso', dados.mensagem || 'Presença confirmada com sucesso!');
    } catch (error) {
        console.error(error);
        exibirFeedback('erro', 'Não foi possível confirmar a presença agora.');
        botaoConfirmar.disabled = false;
    }
});

carregarAluno();
