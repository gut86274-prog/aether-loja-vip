const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'entregas.json');
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const ADM_USER = 'raidi';
const ADM_PASS = '1234';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function lerFila() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ pendentes: [], historico: [], pagamentos: {} }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!data.pagamentos) data.pagamentos = {};
  return data;
}

function salvarFila(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function adicionarEntrega(nick, moedas, origem, txId) {
  const db = lerFila();
  const compra = {
    id: txId || ('AETHER-' + Date.now()),
    nick: String(nick).trim(),
    moedas: parseInt(moedas, 10),
    origem: origem || 'PIX',
    status: 'APROVADO',
    criadoEm: new Date().toISOString()
  };
  db.pendentes.push(compra);
  db.historico.unshift(compra);
  salvarFila(db);
  return compra;
}

app.post('/api/pix/criar', async (req, res) => {
  try {
    const nick = String(req.body.nick || '').trim();
    const moedas = parseInt(req.body.moedas, 10);
    const valor = Number(req.body.valor || 0);
    const email = String(req.body.email || 'player@brasilaether.com.br').trim();

    if (!nick || nick.length < 3 || nick.length > 24) {
      return res.status(400).json({ ok: false, erro: 'Digite um nick valido do SA-MP.' });
    }
    if (!moedas || moedas <= 0 || valor <= 0) {
      return res.status(400).json({ ok: false, erro: 'Pacote de cash invalido.' });
    }

    if (MP_TOKEN && typeof fetch === 'function') {
      const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `aether-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        },
        body: JSON.stringify({
          transaction_amount: Number(valor.toFixed(2)),
          description: `${moedas} Moedas VIP - Brasil Aether RPG (${nick})`,
          payment_method_id: 'pix',
          payer: { email },
          metadata: { nick, moedas }
        })
      });

      const mpData = await mpRes.json();
      if (!mpRes.ok) {
        return res.status(400).json({
          ok: false,
          erro: mpData.message || 'Erro ao gerar Pix no Mercado Pago.'
        });
      }

      const txData = mpData.point_of_interaction?.transaction_data || {};
      const paymentId = String(mpData.id);

      const db = lerFila();
      db.pagamentos[paymentId] = {
        paymentId,
        nick,
        moedas,
        valor,
        entregue: mpData.status === 'approved'
      };
      if (mpData.status === 'approved') {
        adicionarEntrega(nick, moedas, 'PIX_REAL', 'MP-' + paymentId);
      }
      salvarFila(db);

      return res.json({
        ok: true,
        modoReal: true,
        paymentId,
        status: mpData.status,
        qrCodeBase64: txData.qr_code_base64 || '',
        pixCopiaECola: txData.qr_code || ''
      });
    }

    const fakeId = 'PIXTESTE-' + Date.now();
    const db = lerFila();
    db.pagamentos[fakeId] = {
      paymentId: fakeId,
      nick,
      moedas,
      valor,
      entregue: false
    };
    salvarFila(db);

    return res.json({
      ok: true,
      modoReal: false,
      paymentId: fakeId,
      status: 'pending',
      pixCopiaECola: `00020126580014BR.GOV.BCB.PIX0136${fakeId}520400005303986540${valor.toFixed(2).replace('.', '')}5802BR5917BRASIL AETHER RPG6009SAO PAULO62070503***6304ABCD`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: 'Falha interna ao gerar Pix.' });
  }
});

app.get('/api/pix/status/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const db = lerFila();
    const reg = db.pagamentos[id];
    if (!reg) return res.status(404).json({ ok: false, erro: 'Pagamento nao encontrado.' });

    if (MP_TOKEN && !id.startsWith('PIXTESTE-') && typeof fetch === 'function') {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
      });
      const mpData = await mpRes.json();
      if (mpRes.ok) {
        reg.status = mpData.status;
        if (mpData.status === 'approved' && !reg.entregue) {
          reg.entregue = true;
          adicionarEntrega(reg.nick, reg.moedas, 'PIX_REAL', 'MP-' + id);
        } else {
          salvarFila(db);
        }
      }
      return res.json({ ok: true, status: reg.status, entregue: reg.entregue });
    }

    return res.json({ ok: true, status: reg.status || 'pending', entregue: reg.entregue });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: 'Erro ao verificar pagamento.' });
  }
});

app.post('/api/pix/confirmar-teste', (req, res) => {
  const id = String(req.body.paymentId || '').trim();
  const db = lerFila();
  const reg = db.pagamentos[id];
  if (!reg) return res.status(404).json({ ok: false, erro: 'Pagamento nao encontrado.' });

  if (!reg.entregue) {
    reg.entregue = true;
    reg.status = 'approved';
    adicionarEntrega(reg.nick, reg.moedas, 'PIX_TESTE', id);
  }
  return res.json({ ok: true, moedas: reg.moedas, nick: reg.nick });
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

app.post('/api/adm/login', (req, res) => {
  const nick = String(req.body.nick || '').trim().toLowerCase();
  const senha = String(req.body.senha || '').trim();

  if (nick !== ADM_USER || senha !== ADM_PASS) {
    return res.status(401).json({ ok: false, erro: 'Acesso negado. Apenas raidi com senha valida.' });
  }

  const db = lerFila();
  return res.json({
    ok: true,
    pixRealAtivo: Boolean(MP_TOKEN),
    pendentes: db.pendentes,
    historico: db.historico.slice(0, 20)
  });
});

app.post('/api/adm/enviar-cash', (req, res) => {
  const nickAdm = String(req.body.nickAdm || '').trim().toLowerCase();
  const senha = String(req.body.senha || '').trim();
  const nickAlvo = String(req.body.nickAlvo || '').trim();
  const moedas = parseInt(req.body.moedas, 10);

  if (nickAdm !== ADM_USER || senha !== ADM_PASS) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado.' });
  }
  if (!nickAlvo || nickAlvo.length < 3 || !moedas || moedas <= 0) {
    return res.status(400).json({ ok: false, erro: 'Informe nick alvo e quantidade de cash valida.' });
  }

  const compra = adicionarEntrega(nickAlvo, moedas, 'ADM_RAIDI', 'ADM-' + Date.now());
  const db = lerFila();
  return res.json({
    ok: true,
    compra,
    pendentes: db.pendentes,
    historico: db.historico.slice(0, 20)
  });
});

app.listen(PORT, () => {
  console.log(`Brasil Aether Cash Store rodando na porta ${PORT}`);
});
