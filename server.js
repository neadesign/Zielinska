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

const START_DATE = new Date("2025-05-23");
const sheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vScTm1j0tp3F7h89bhmLGqEJr4nlJuqPCPm8j57qn3xqFfIYk3Mf89KXRWqbxzmxA/pub?output=csv";

async function isDateOpen(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date) || date < START_DATE || date.getDay() === 3) return false;
  try {
    const response = await fetch(sheetUrl);
    const text = await response.text();
    const blockedDates = text.split('\n').map(r => r.trim()).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r));
    return !blockedDates.includes(dateStr);
  } catch (err) {
    console.error("\u274C Errore fetch calendario:", err);
    return false;
  }
}

const app = express();
app.use(cors());

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('\u2705 Webhook ricevuto:', event.type);
  } catch (err) {
    console.error('\u274C Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('🔍 Webhook ricevuto con source:', session.metadata?.source);
    let summary = session.metadata?.orderDetails || '\u26A0\uFE0F Nessun dettaglio ordine';
    if (sessionOrderDetails.has(session.id)) {
      summary = sessionOrderDetails.get(session.id);
    }

    const orderId = session.metadata?.orderId || 'Ordine';
    const message = `\ud83d\udce6 *Neaspace – ${orderId}*\n\n${summary}`;

    try {
      await transporter.sendMail({
        from: 'Neaspace <design@francescorossi.co>',
        to: 'design@francescorossi.co',
        subject: `\u2705 Ordine confermato – ${orderId}`,
        text: message.replace(/\*/g, '')
      });
      console.log('\ud83d\udce7 Email inviata');
    } catch (err) {
      console.error('\u274C Errore invio email:', err.message);
    }

    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      });
      console.log('\u2705 Notifica Telegram inviata');
    } catch (err) {
      console.error('\u274C Errore invio Telegram:', err.message);
    }

if ((session.metadata?.source || '').toLowerCase() === 'zielinska') {
  try {
    await fetch('https://hooks.zapier.com/hooks/catch/15200900/2js6103/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderDetails: summary,
        deliveryDate: session.metadata?.delivery_date,
        source: session.metadata?.source || 'unknown',
        language: 'fr'
      })
    });
    console.log('✅ Inviato a Zapier con successo');
  } catch (err) {
    console.error('❌ Errore invio Zapier:', err.message);
  }
} else {
  console.log(`⛔ Zapier NON attivato perché source = '${session.metadata?.source}'`);
}
  }

  res.sendStatus(200);
});

app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
  const { total, orderDetailsShort, orderDetailsLong, delivery_date, phone, source } = req.body;

  if (!total || total <= 0) {
    return res.status(400).json({ error: "\u274C L'importo totale non pu\u00f2 essere zero. Seleziona almeno una formula o un supplemento." });
  }

  const available = await isDateOpen(delivery_date);
  if (!available) {
    return res.status(400).json({ error: "\u274C Siamo chiusi in quella data. Scegli un altro giorno." });
  }

  const orderId = crypto.randomUUID().slice(0, 8);
  const preMessage = `\ud83d\udce5 *Nuovo ordine in attesa di pagamento – ${orderId}*\n\n${orderDetailsLong}`;

  try {
    await transporter.sendMail({
      from: 'Neaspace <design@francescorossi.co>',
      to: 'design@francescorossi.co',
      subject: `\ud83e\uddfa Nuovo ordine – ${orderId}`,
      text: preMessage.replace(/\*/g, '')
    });

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: preMessage,
      parse_mode: 'Markdown'
    });

    console.log('\ud83d\udce7 Email + Telegram inviati PRIMA del pagamento');
  } catch (err) {
    console.error('\u274C Errore invio Email o Telegram:', err.message);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Neaspace Order' },
          unit_amount: Math.round(total * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: 'https://neadesign.github.io/Zielinska/success.html',
      cancel_url: 'https://neadesign.github.io/Zielinska/cancel.html',
      metadata: {
  total: total.toFixed(2),
  delivery_date,
  orderDetails: orderDetailsShort,
  orderId,
  source // prende "Zielinska" dal body
}
    });

    sessionOrderDetails.set(session.id, orderDetailsLong);
    res.json({ url: session.url });
  } catch (err) {
    console.error('\u274C Errore creazione sessione Stripe:', err.message);
    res.status(500).json({ error: 'Errore interno creazione sessione Stripe' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Server attivo su http://localhost:${PORT}`);
});
