from textwrap import dedent

corrected_code = dedent("""
    require('dotenv').config(); // Carica variabili ambiente dal file .env se presente

    const express = require('express');
    const Stripe = require('stripe');
    const cors = require('cors');
    const nodemailer = require('nodemailer');
    const axios = require('axios');
    const fetch = require('node-fetch');
    const csv = require('csvtojson');

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const GMAIL_PASS = process.env.GMAIL_PASS;

    const START_DATE = new Date("2025-05-23");
    const sheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vScTm1j0tp3F7h89bhmLGqEJr4nlJuqPCPm8j57qn3xqFfIYk3Mf89KXRWqbxzmxA/pub?output=csv";

    async function isDateOpen(dateStr) {
      const date = new Date(dateStr);
      if (isNaN(date)) return false;
      if (date < START_DATE) return false;
      if (date.getDay() === 3) return false;

      try {
        const response = await fetch(sheetUrl);
        const text = await response.text();
        const rows = text.split('\\n').map(r => r.trim());
        const blockedDates = rows.filter(r => /^\\d{4}-\\d{2}-\\d{2}$/.test(r));
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
        const orderDetails = session.metadata?.orderDetails || '⚠️ Nessun dettaglio ordine';
        const total = session.metadata?.total || '0.00';

        const message = `📦 *Nuovo ordine Neaspace!*\\n\\n${orderDetails}`;

        try {
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: '19rueneuve@gmail.com',
              pass: GMAIL_PASS
            }
          });

          const mailOptions = {
            from: 'Neaspace <design@francescorossi.co>',
            to: 'design@francescorossi.co, dominika@zielinska.fr',
            subject: '✅ Ordine confermato',
            text: message.replace(/\\*/g, '')
          };

          const info = await transporter.sendMail(mailOptions);
          console.log('📧 Email inviata:', info.response);
        } catch (error) {
          console.error('❌ Errore invio email:', error.message);
        }

        try {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
          });
        } catch (err) {
          console.error('❌ Errore invio Telegram:', err.message);
        }
      }

      res.sendStatus(200);
    });

    app.use(express.json());

    app.post('/create-checkout-session', async (req, res) => {
      const { total, orderDetails, delivery_date, stripeSummary } = req.body;

      if (!total || total <= 0) {
        return res.status(400).json({
          error: "❌ Le montant total ne peut pas être zéro. Veuillez sélectionner une formule ou un supplément."
        });
      }

      const available = await isDateOpen(delivery_date);
      if (!available) {
        return res.status(400).json({
          error: "❌ Désolé, mais le fournil est fermé le jour sélectionné. Merci de choisir une autre date."
        });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: 'Petit-déjeuner Neaspace',
              },
              unit_amount: Math.round(total * 100),
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: 'https://neadesign.github.io/Zielinska/success.html',
          cancel_url: 'https://neadesign.github.io/Zielinska/cancel.html',
          metadata: {
            stripeSummary,
            total: total.toFixed(2),
            delivery_date
          }
        });

        res.json({ url: session.url });
      } catch (err) {
        console.error('❌ Errore creazione sessione Stripe:', err.message);
        res.status(500).json({ error: 'Errore creazione sessione Stripe' });
      }
    });

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
      console.log(`🚀 Server attivo su http://localhost:${PORT}`);
    });
""")

corrected_code[:500]  # Preview the beginning of the corrected version
