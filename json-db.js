const fs = require('fs/promises');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

// Função para ler todo o banco de dados
async function readDB() {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Se o arquivo não existir (ENOENT), retorna uma estrutura vazia para ser criada depois.
        if (error.code === 'ENOENT') {
            return { alunos: [], registros: [] };
        }
        throw error;
    }
}

// Função para escrever o banco de dados inteiro
async function writeDB(data) {
    // O 'null, 2' formata o JSON para ser legível por humanos
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readDB, writeDB };