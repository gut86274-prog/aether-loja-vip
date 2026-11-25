const express = require('express');
const mercadopago = require('mercadopago');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// CONFIGURAÇÕES - Coloque seu Token do Mercado Pago aqui
mercadopago.configure({
    access_token: process.env.MP_TOKEN // Usaremos variável de ambiente no Render
});

// Banco de dados temporário (Em memória)
// NOTA: Se o Render reiniciar, a lista limpa. Para algo permanente, usa-se MongoDB.
let vendas = []; 

// Rota para criar o pagamento
app.post('/create-payment', async (req, res) => {
    const { nick, amount } = req.body;

    const payment_data = {
        transaction_amount: parseFloat(amount),
        description: `Compra de Moedas VIP - Jogador: ${nick}`,
        payment_method_id: 'pix',
        payer: { email: 'cliente@email.com' } // Email genérico
    };

    try {
        const response = await mercadopago.payment.create(payment_data);
        
        // Salva a venda como "pendente"
        vendas.push({
            id: response.body.id,
            nick: nick,
            amount: amount,
            status: 'pendente',
            date: new Date().toLocaleString()
        });

        res.json({ 
            qr_code: response.body.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: response.body.point_of_interaction.transaction_data.qr_code_base64 
        });
    } catch (error) {
        res.status(500).send("Erro ao gerar Pix");
    }
});

// Webhook: O Mercado Pago avisa aqui quando o Pix for pago
app.post('/webhook', async (req, res) => {
    const { data } = req.body;
    if (data && data.id) {
        const payment = await mercadopago.payment.get(data.id);
        if (payment.body.status === 'approved') {
            const venda = vendas.find(v => v.id === data.id);
            if (venda) venda.status = 'pago';
        }
    }
    res.sendStatus(200);
});

// Rota para o Admin ver as vendas
app.get('/admin/vendas', (req, res) => {
    res.json(vendas);
});

// Rota para marcar como entregue
app.post('/admin/entregar', (req, res) => {
    const { id } = req.body;
    const venda = vendas.find(v => v.id === id);
    if (venda) venda.status = 'entregue';
    res.send("Marcado como entregue!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
