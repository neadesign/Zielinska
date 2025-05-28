require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const crypto = require('crypto');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GMAIL_PASS = process.env.GMAIL_PASS;

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '19rueneuve@gmail.com',
    pass: GMAIL_PASS
  }
});

app.post('/create-checkout-session', async (req, res) => {
  const { type, cart, orderDetails, total } = req.body;

  if (!total || total <= 0 || !cart || cart.length === 0) {
    return res.status(400).json({ error: "❌ Totale o carrello non valido." });
  }

  const orderId = crypto.randomUUID().slice(0, 8);
  const preMessage = `📦 *Nuovo ordine MINIBAR – ${orderId}*\n\n${orderDetails}`;

  // Invia Email + Telegram PRIMA del pagamento
  try {
    await transporter.sendMail({
      from: 'Neaspace <design@francescorossi.co>',
      to: 'design@francescorossi.co',
      subject: `🧾 Nuovo ordine – ${orderId}`,
      text: preMessage.replace(/\*/g, '')
    });

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: preMessage,
      parse_mode: 'Markdown'
    });

    console.log('📧 Notifiche pre-pagamento inviate');
  } catch (err) {
    console.error('❌ Errore invio notifiche:', err.message);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: cart.map(item => ({
        price_data: {
          currency: 'eur',
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100)
        },
        quantity: item.qty
      })),
      mode: 'payment',
      success_url: 'https://neadesign.github.io/minibar/success001.html',
      cancel_url: 'https://neadesign.github.io/minibar/cancel001.html',
      metadata: {
        orderId,
        orderDetails
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Errore Stripe:', err.message);
    res.status(500).json({ error: 'Errore durante la creazione della sessione di pagamento' });
  }
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`🚀 Minibar server attivo su http://localhost:${PORT}`);
});
