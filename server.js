const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const mercadopago = require('mercadopago');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// CONFIGURAÇÕES
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
    secret: 'aether_secret_key_123',
    resave: false,
    saveUninitialized: true
}));

// CONEXÃO BANCO DE DADOS
mongoose.connect(process.env.MONGO_URI).then(() => console.log("MongoDB Conectado! ✅"));

// MODELOS DE DADOS
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    nickSAMP: String,
    role: { type: String, default: 'user' }
});
const User = mongoose.model('User', UserSchema);

const OrderSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    nick: String,
    amount: Number,
    status: { type: String, default: 'pendente' },
    date: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

mercadopago.configure({ access_token: process.env.MP_TOKEN });

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/auth/register', async (req, res) => {
    try {
        const { username, password, nickSAMP } = req.body;
        const hashedPwd = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPwd, nickSAMP });
        await newUser.save();
        res.json({ success: true, msg: "Conta criada com sucesso!" });
    } catch (e) { res.status(400).json({ error: "Usuário já existe!" }); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        req.session.username = user.username;
        res.json({ success: true });
    } else { res.status(401).json({ error: "Login ou senha incorretos!" }); }
});

app.get('/auth/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não logado" });
    res.json({ username: req.session.username });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ROTAS DA LOJA ---

app.post('/create-payment', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Faça login primeiro!" });
    
    const { nick, amount } = req.body;
    const payment_data = {
        transaction_amount: parseFloat(amount),
        description: `Moedas VIP - ${nick}`,
        payment_method_id: 'pix',
        payer: { email: 'cliente@email.com' }
    };

    try {
        const response = await mercadopago.payment.create(payment_data);
        const newOrder = new Order({ userId: req.session.userId, nick, amount, status: 'pendente' });
        await newOrder.save();

        res.json({ 
            qr_code: response.body.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: response.body.point_of_interaction.transaction_data.qr_code_base64 
        });
    } catch (e) { res.status(500).json({ error: "Erro no Mercado Pago" }); }
});

// Webhook para atualizar pagamento
app.post('/webhook', async (req, res) => {
    const { data } = req.body;
    if (data && data.id) {
        const payment = await mercadopago.payment.get(data.id);
        if (payment.body.status === 'approved') {
            await Order.findOneAndUpdate({ _id: data.id }, { status: 'pago' }); // Simplificado
        }
    }
    res.sendStatus(200);
});

// ADMIN
app.get('/admin/vendas', async (req, res) => {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
});

app.post('/admin/entregar', async (req, res) => {
    await Order.findByIdAndUpdate(req.body.id, { status: 'entregue' });
    res.send("Entregue!");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Portal Aether Online na porta ${PORT}`));
