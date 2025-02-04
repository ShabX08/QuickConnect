import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const HUBNET_API_KEY = process.env.HUBNET_API_KEY;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;

if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY || !PAYSTACK_PUBLIC_KEY) {
  console.error("Missing required environment variables. Please check your .env file.");
  process.exit(1);
}

function generateReference() {
  const prefix = 'MTN_ALT_';
  const randomNum = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
  return `${prefix}${randomNum}`;
}

app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email } = req.body;
  if (!network || !phone || !volume || !amount || !email) {
    console.error("Missing required payment data:", req.body);
    return res.status(400).json({ status: "error", message: "Missing required payment data." });
  }

  const reference = generateReference();
  console.log(`Initiating payment for reference: ${reference}`);

  try {
    const amountInKobo = Math.round(amount * 100);
    const callback_url = `${BASE_URL}/payment/callback`;

    const payload = {
      amount: amountInKobo,
      email,
      callback_url,
      reference,
      metadata: { network, phone, volume }
    };

    console.log("Sending request to Paystack API:", payload);

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await paystackResponse.json();
    console.log("Received response from Paystack API:", data);

    if (data.status && data.data) {
      return res.json({
        status: "success",
        data: {
          publicKey: PAYSTACK_PUBLIC_KEY,
          amount: amountInKobo,
          reference: data.data.reference,
          authorization_url: data.data.authorization_url
        }
      });
    } else {
      console.error("Paystack API error:", data);
      return res.status(400).json({
        status: "error",
        message: data.message || "Failed to initialize payment"
      });
    }
  } catch (error) {
    console.error("Error in Paystack API request:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while processing your request."
    });
  }
});

app.get("/payment/callback", async (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    console.error("Missing reference in callback");
    return res.redirect(`${BASE_URL}/index.html?status=error&message=Missing reference`);
  }

  console.log(`Processing payment callback for reference: ${reference}`);

  try {
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    });
    const verifyData = await verifyResponse.json();
    console.log("Paystack verification response:", verifyData);

    if (!(verifyData.status && verifyData.data && verifyData.data.status === "success")) {
      console.error("Payment verification failed:", verifyData);
      return res.redirect(`${BASE_URL}/index.html?status=payment_failed&message=Payment verification failed`);
    }

    const { network, phone, volume } = verifyData.data.metadata;
    const hubnetEndpoint = `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`;

    const hubnetPayload = {
      phone,
      volume: volume.toString(),
      reference
    };

    console.log("Sending request to Hubnet API:", hubnetPayload);

    const hubnetResponse = await fetch(hubnetEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: `Bearer ${HUBNET_API_KEY}`
      },
      body: JSON.stringify(hubnetPayload)
    });
    const hubnetData = await hubnetResponse.json();
    console.log("Hubnet response:", hubnetData);

    if (hubnetData.status && hubnetData.code === "0000") {
      console.log(`Successfully sent data bundle for reference: ${reference}`);
      return res.redirect(`${BASE_URL}/payment-success.html`);
    } else {
      console.error("Failed to send data bundle:", hubnetData);
      return res.redirect(`${BASE_URL}/payment-failed.html`);
    }
  } catch (error) {
    console.error("Error during payment verification or Hubnet transaction:", error);
    return res.redirect(`${BASE_URL}/index.html?status=error&message=An unexpected error occurred`);
  }
});

app.listen(port, () => {
  console.log(`Server running at ${BASE_URL}`);
  console.log("Hubnet API Key configured:", Boolean(HUBNET_API_KEY));
  console.log("Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY));
  console.log("Paystack Public Key configured:", Boolean(PAYSTACK_PUBLIC_KEY));
});
