// server001.js – Minibar Server
require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fetch = require('node-fetch');
const crypto = require('crypto');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GMAIL_PASS = process.env.GMAIL_PASS;

const sessionOrderDetails = new Map();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '19rueneuve@gmail.com',
    pass: GMAIL_PASS
  }
});

const app = express();
app.use(cors());

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('✅ Webhook ricevuto:', event.type);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    let summary = session.metadata?.orderDetails || '⚠️ Nessun dettaglio ordine';
    if (sessionOrderDetails.has(session.id)) {
      summary = sessionOrderDetails.get(session.id);
    }

    const orderId = session.metadata?.orderId || 'Ordine';
    const message = `🍼 *Minibar – ${orderId}*

${summary}`;

    try {
      await transporter.sendMail({
        from: 'Minibar Neaspace <design@francescorossi.co>',
        to: 'design@francescorossi.co',
        subject: `✅ Ordine minibar confermato – ${orderId}`,
        text: message.replace(/\*/g, '')
      });
      console.log('📧 Email inviata');
    } catch (err) {
      console.error('❌ Errore invio email:', err.message);
    }

    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      });
      console.log('✅ Notifica Telegram inviata');
    } catch (err) {
      console.error('❌ Errore invio Telegram:', err.message);
    }

    try {
      await fetch('https://hooks.zapier.com/hooks/catch/15200900/2js6103/001', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderDetails: summary,
          deliveryDate: session.metadata?.delivery_date,
          source: 'stripe-webhook-minibar',
          language: 'fr'
        })
      });
      console.log('✅ Inviato a Zapier con successo');
    } catch (err) {
      console.error('❌ Errore invio Zapier:', err.message);
    }
  }

  res.sendStatus(200);
});

app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
  const { total, orderDetailsShort, orderDetailsLong, delivery_date, phone } = req.body;

  if (!total || total <= 0) {
    return res.status(400).json({ error: "\u274C L'importo totale non pu\u00f2 essere zero." });
  }

  const orderId = crypto.randomUUID().slice(0, 8);
  const preMessage = `📥 *Nuovo ordine MINIBAR in attesa di pagamento – ${orderId}*

${orderDetailsLong}`;

  try {
    await transporter.sendMail({
      from: 'Minibar Neaspace <design@francescorossi.co>',
      to: 'design@francescorossi.co',
      subject: `🧺 Nuovo ordine minibar – ${orderId}`,
      text: preMessage.replace(/\*/g, '')
    });

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: preMessage,
      parse_mode: 'Markdown'
    });

    console.log('📧 Email + Telegram inviati PRIMA del pagamento');
  } catch (err) {
    console.error('❌ Errore invio Email o Telegram:', err.message);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Minibar Order' },
          unit_amount: Math.round(total * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: 'https://neadesign.github.io/Zielinska/success001.html',
      cancel_url: 'https://neadesign.github.io/Zielinska/cancel001.html',
      metadata: {
        total: total.toFixed(2),
        delivery_date,
        orderDetails: orderDetailsShort,
        orderId
      }
    });

    sessionOrderDetails.set(session.id, orderDetailsLong);
    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Errore creazione sessione Stripe:', err.message);
    res.status(500).json({ error: 'Errore interno creazione sessione Stripe' });
  }
});

const PORT = process.env.PORT || 10001;
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Minibar Server attivo su http://localhost:${PORT}`);
});
