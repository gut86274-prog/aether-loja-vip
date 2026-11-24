const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'entregas.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function lerFila() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ pendentes: [], historico: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function salvarFila(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.post('/api/comprar', (req, res) => {
  const { nick, moedas } = req.body;
  const nickLimpo = String(nick || '').trim();
  const qtd = parseInt(moedas, 10);

  if (!nickLimpo || nickLimpo.length < 3 || nickLimpo.length > 24) {
    return res.status(400).json({ ok: false, erro: 'Nick invalido.' });
  }
  if (!qtd || qtd <= 0 || qtd > 5000000) {
    return res.status(400).json({ ok: false, erro: 'Quantidade de Moedas VIP invalida.' });
  }

  const db = lerFila();
  const compra = {
    id: 'TESTE-' + Date.now(),
    nick: nickLimpo,
    moedas: qtd,
    status: 'APROVADO_TESTE',
    criadoEm: new Date().toISOString()
  };

  db.pendentes.push(compra);
  db.historico.unshift(compra);
  salvarFila(db);

  return res.json({ ok: true, compra });
});

app.get('/api/resgatar', (req, res) => {
  const nick = String(req.query.nick || '').trim().toLowerCase();
  if (!nick) return res.status(400).json({ ok: false, moedas: 0 });

  const db = lerFila();
  let totalMoedas = 0;
  const restantes = [];

  for (const item of db.pendentes) {
    if (item.nick.toLowerCase() === nick) {
      totalMoedas += item.moedas;
    } else {
      restantes.push(item);
    }
  }

  if (totalMoedas > 0) {
    db.pendentes = restantes;
    salvarFila(db);
  }

  return res.json({ ok: true, moedas: totalMoedas });
});

app.get('/api/status', (req, res) => {
  const db = lerFila();
  res.json({
    pendentes: db.pendentes.length,
    ultimas: db.historico.slice(0, 8)
  });
});

app.listen(PORT, () => {
  console.log(`Aether Loja VIP rodando na porta ${PORT}`);
});
