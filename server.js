const { google } = require('googleapis');
const crypto = require('crypto');

const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: "rue-neuve",
    private_key_id: "4e2c19d39078455fb00f0ac350aea60e1c15a864",
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: "design-francescorossi-co@rue-neuve.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token"
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function appendToSheet(date, phone, summary, total) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: '1KEkvZp2kg4fA5snVhJBupgR6J-CuLqlbtodd8g9Rfag',
    range: 'Foglio1!A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[date, phone, summary, total]]
    }
  });
}

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fetch = require('node-fetch');

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
    console.error("❌ Errore fetch calendario:", err);
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
    const message = `📦 *Neaspace – ${orderId}*\n\n${summary}`;

    try {
      await transporter.sendMail({
        from: 'Neaspace <design@francescorossi.co>',
        to: 'design@francescorossi.co',
        subject: `✅ Ordine confermato – ${orderId}`,
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
      await fetch('https://hooks.zapier.com/hooks/catch/15200900/2js6103/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderDetails: summary,
          deliveryDate: session.metadata?.delivery_date,
          source: 'stripe-webhook',
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
    return res.status(400).json({ error: "❌ L'importo totale non può essere zero. Seleziona almeno una formula o un supplemento." });
  }

  const available = await isDateOpen(delivery_date);
  if (!available) {
    return res.status(400).json({ error: "❌ Siamo chiusi in quella data. Scegli un altro giorno." });
  }

  const orderId = crypto.randomUUID().slice(0, 8);
  await appendToSheet(delivery_date, phone, orderDetailsLong, total);

  const preMessage = `📥 *Nuovo ordine in attesa di pagamento – ${orderId}*\n\n${orderDetailsLong}`;

  try {
    await transporter.sendMail({
      from: 'Neaspace <design@francescorossi.co>',
      to: 'design@francescorossi.co',
      subject: `🧺 Nuovo ordine – ${orderId}`,
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server attivo su http://localhost:${PORT}`);
});
