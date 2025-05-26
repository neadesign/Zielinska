require('dotenv').config(); // Carica variabili ambiente dal file .env se presente

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

// Transporter per Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '19rueneuve@gmail.com',
    pass: GMAIL_PASS
  }
});

const START_DATE = new Date("2025-05-23");
const sheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vScTm1j0tp3F7h89bhmLGqEJr4nlJuqPCPm8j57qn3xqFfIYk3Mf89KXRWqbxzmxA/pub?output=csv";

// Funzione di utilità per controllare se la data è aperta
async function isDateOpen(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date)) return false;
  if (date < START_DATE) return false;
  if (date.getDay() === 3) return false; // mercoledì chiuso
  try {
    const response = await fetch(sheetUrl);
    const text = await response.text();
    const blockedDates = text
      .split('\n')
      .map(r => r.trim())
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r));
    return !blockedDates.includes(dateStr);
  } catch (err) {
    console.error("❌ Errore fetch calendario:", err);
    return false;
  }
}

const app = express();
app.use(cors());

// Webhook Stripe: deve usare express.raw
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
    // Leggi il riepilogo breve dai metadata
    const summary = session.metadata?.orderDetails || session.metadata?.stripeSummary || '⚠️ Nessun dettaglio ordine';
    const message = `📦 *Neaspace!*\n\n${summary}`;

    // Invia l'email
    try {
      await transporter.sendMail({
        from: 'Neaspace <design@francescorossi.co>',
        to: 'design@francescorossi.co',
        subject: '✅ Ordine confermato',
        text: message.replace(/\*/g, '')
      });
      console.log('📧 Email inviata');
    } catch (err) {
      console.error('❌ Errore invio email:', err.message);
    }

    // Invia la notifica su Telegram
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
 // Invia anche a Zapier
try {
  await fetch('https://hooks.zapier.com/hooks/catch/15200900/2js6103/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderDetails: "Formula Petit-déj – 13 €:\n- Viennoiserie: Babka\n- Lait: Lait d’avoine\n- Jus d’orange\nLivraison: 27 mai à 08:30",
      deliveryDate: session.metadata?.delivery_date,
      source: 'stripe-webhook',
      language: 'fr' // oppure calcolato in base al contesto
    })
  });
  console.log('✅ Inviato a Zapier con successo');
} catch (err) {
  console.error('❌ Errore invio Zapier:', err.message);
}
 }

  res.sendStatus(200);
});

// Aggiungi il parser JSON **dopo** il webhook
app.use(express.json());

// Endpoint per creare la sessione di Checkout
app.post('/create-checkout-session', async (req, res) => {
  const {
    total,
    orderDetails,
    // puoi rimuovere gli altri orderDetails* se non li usi nei metadata
    // orderDetailsFr,
    // orderDetailsIt,
    // orderDetailsEs,
    // orderDetailsEn,
    delivery_date,
    stripeSummary
  } = req.body;

  // Verifica totale
  if (!total || total <= 0) {
    return res.status(400).json({
      error: "❌ L'importo totale non può essere zero. Seleziona almeno una formula o un supplemento."
    });
  }

  // Controllo disponibilità data
  const available = await isDateOpen(delivery_date);
  if (!available) {
    return res.status(400).json({
      error: "❌ Siamo chiusi in quella data. Scegli un altro giorno."
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Neaspace Order' },
          unit_amount: Math.round(total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://neadesign.github.io/Zielinska/success.html',
      cancel_url: 'https://neadesign.github.io/Zielinska/cancel.html',
      metadata: {
        stripeSummary,
        orderDetails,
        total: total.toFixed(2),
        delivery_date
      }
    });

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
