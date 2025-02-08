import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://your-firebase-app-url.web.app";
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`;

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const HUBNET_API_KEY = process.env.HUBNET_API_KEY;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;

if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY || !PAYSTACK_PUBLIC_KEY) {
  console.error("Missing required environment variables. Please check your .env file.");
  process.exit(1);
}

// In-memory storage for transactions
const transactions = new Map();

// Transaction statuses
const STATUS = {
  INITIATED: "INITIATED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  ERROR: "ERROR",
};

// Helper functions
function generateReference() {
  return `MTN_ALT_${crypto.randomBytes(8).toString("hex")}`;
}

function getTransactionByReference(reference) {
  return transactions.get(reference);
}

function createTransaction(reference, data) {
  if (transactions.has(reference)) return transactions.get(reference);
  const transaction = { ...data, status: STATUS.INITIATED, createdAt: Date.now() };
  transactions.set(reference, transaction);
  return transaction;
}

function updateTransaction(reference, updates) {
  if (!transactions.has(reference)) return null;
  const updatedTransaction = { ...transactions.get(reference), ...updates, updatedAt: Date.now() };
  transactions.set(reference, updatedTransaction);
  return updatedTransaction;
}

// Middleware
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({ status: "error", message: "An unexpected error occurred" });
}

// Paystack Integration
async function initializePaystackPayment(payload) {
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  return await response.json();
}

async function verifyPaystackPayment(reference) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  return await response.json();
}

// Hubnet Integration
async function checkHubnetBalance() {
  const response = await fetch("https://console.hubnet.app/live/api/context/business/transaction/check_balance", {
    method: "GET",
    headers: {
      token: `Bearer ${HUBNET_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return await response.json();
}

async function processHubnetTransaction(payload) {
  const response = await fetch("https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction", {
    method: "POST",
    headers: {
      token: `Bearer ${HUBNET_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return await response.json();
}

// Routes

// Initiate Payment
app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email } = req.body;
  if (!network || !phone || !volume || !amount || !email) {
    return res.status(400).json({ status: "error", message: "Missing required payment data." });
  }

  const reference = generateReference();
  createTransaction(reference, { network, phone, volume, amount, email, status: STATUS.INITIATED });

  try {
    const amountInKobo = Math.round(amount * 100);
    const payload = {
      amount: amountInKobo,
      email,
      callback_url: `${BASE_URL}/payment/callback`,
      reference,
      metadata: { network, phone, volume },
    };

    const data = await initializePaystackPayment(payload);
    if (!data.status || !data.data) {
      throw new Error("Failed to initialize payment: " + (data.message || "Unknown error"));
    }

    updateTransaction(reference, { paystackData: data.data });
    return res.json({ status: "success", data: data.data });
  } catch (error) {
    console.error("Error initializing Paystack payment:", error);
    return res.status(500).json({ status: "error", message: "Failed to initialize payment. Please try again." });
  }
});

// Payment Callback
app.get("/payment/callback", async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect(`${FRONTEND_URL}?status=error&message=Missing reference`);

  const transaction = getTransactionByReference(reference);
  if (!transaction) {
    return res.redirect(`${FRONTEND_URL}?status=error&message=Invalid transaction`);
  }

  if (transaction.status === STATUS.COMPLETED) {
    return res.redirect(`${FRONTEND_URL}?status=success&message=Transaction completed successfully&reference=${reference}`);
  }

  try {
    const verifyData = await verifyPaystackPayment(reference);

    if (!verifyData.status || verifyData.data.status !== "success") {
      throw new Error("Payment verification failed");
    }

    updateTransaction(reference, { status: STATUS.PROCESSING });
    console.log(`✅ Payment verified: ${reference}, initiating Hubnet request...`);

    const hubnetPayload = {
      phone: transaction.phone,
      volume: transaction.volume.toString(),
      reference,
      referrer: transaction.phone,
      webhook: `${BASE_URL}/hubnet/webhook`,
    };
    const hubnetData = await processHubnetTransaction(hubnetPayload);

    console.log("📡 Hubnet response:", hubnetData);

    if (hubnetData.status && hubnetData.data && hubnetData.data.code === "0000") {
      updateTransaction(reference, { status: STATUS.COMPLETED });
      return res.redirect(`${FRONTEND_URL}?status=success&message=Transaction completed successfully&reference=${reference}`);
    }
    throw new Error("Hubnet processing failed");
  } catch (error) {
    console.error("❌ Error processing transaction:", error);
    updateTransaction(reference, { status: STATUS.FAILED });
    return res.redirect(`${FRONTEND_URL}?status=error&message=Transaction processing failed&reference=${reference}`);
  }
});

// Hubnet Webhook
app.post("/hubnet/webhook", async (req, res) => {
  const { reference, status } = req.body;
  console.log("Received Hubnet webhook:", req.body);

  if (reference && status) {
    const transaction = getTransactionByReference(reference);
    if (transaction) {
      updateTransaction(reference, { status: status === "success" ? STATUS.COMPLETED : STATUS.FAILED });
      
      // Send a response to the frontend
      try {
        const frontendResponse = await fetch(`${FRONTEND_URL}/update-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reference,
            status: status === "success" ? "success" : "error",
            message: status === "success" ? "Transaction completed successfully" : "Transaction failed",
          }),
        });

        if (!frontendResponse.ok) {
          console.error("Failed to send status update to frontend");
        }
      } catch (error) {
        console.error("Error sending status update to frontend:", error);
      }
    }
  }

  res.sendStatus(200);
});

// Check Hubnet Balance
app.get("/api/check-balance", async (req, res) => {
  try {
    const balanceData = await checkHubnetBalance();
    res.json(balanceData);
  } catch (error) {
    console.error("Error checking Hubnet balance:", error);
    res.status(500).json({ status: "error", message: "Failed to check balance" });
  }
});

// Track Order
app.get("/api/track-order", async (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).json({ status: "error", message: "Missing order reference" });
  }

  try {
    // Check Paystack transaction status
    const paystackData = await verifyPaystackPayment(reference);

    if (paystackData.status && paystackData.data) {
      const orderData = {
        reference: paystackData.data.reference,
        amount: paystackData.data.amount / 100, // Convert from kobo to naira
        status: paystackData.data.status,
        phone: paystackData.data.metadata.phone,
        volume: paystackData.data.metadata.volume,
        timestamp: new Date(paystackData.data.paid_at).getTime(),
      };

      return res.json({ status: "success", data: orderData });
    } else {
      return res.status(404).json({ status: "error", message: "Order not found" });
    }
  } catch (error) {
    console.error("Error tracking order:", error);
    return res.status(500).json({ status: "error", message: "Failed to track order" });
  }
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY));
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY));
  console.log("🔑 Paystack Public Key configured:", Boolean(PAYSTACK_PUBLIC_KEY));
});

