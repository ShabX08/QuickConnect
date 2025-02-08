import express from "express"
import cors from "cors"
import fetch from "node-fetch"
import * as dotenv from "dotenv"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000
const FRONTEND_URL = process.env.FRONTEND_URL || "https://quickconnectgh.web.app"
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`

app.use(cors())
app.use(express.static(path.join(__dirname, "public")))
app.use(express.json())

const HUBNET_API_KEY = process.env.HUBNET_API_KEY
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY

if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY || !PAYSTACK_PUBLIC_KEY) {
  console.error("Missing required environment variables. Please check your .env file.")
  process.exit(1)
}

// In-memory storage for transactions
const transactions = new Map()

// Transaction statuses
const STATUS = {
  INITIATED: "INITIATED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  ERROR: "ERROR",
}

// Helper functions
function generateReference() {
  return `MTN_ALT_${crypto.randomBytes(8).toString("hex")}`
}

function getTransactionByReference(reference) {
  return transactions.get(reference)
}

function createTransaction(reference, data) {
  if (transactions.has(reference)) return transactions.get(reference)
  const transaction = { ...data, status: STATUS.INITIATED, createdAt: Date.now() }
  transactions.set(reference, transaction)
  return transaction
}

function updateTransaction(reference, updates) {
  if (!transactions.has(reference)) return null
  const updatedTransaction = { ...transactions.get(reference), ...updates, updatedAt: Date.now() }
  transactions.set(reference, updatedTransaction)
  return updatedTransaction
}

// Middleware
function errorHandler(err, req, res, next) {
  console.error("Error:", err)
  res.status(500).json({ status: "error", message: "An unexpected error occurred", error: err.message })
}

// Paystack Integration
async function initializePaystackPayment(payload) {
  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      body: JSON.stringify(payload),
    })
    return await response.json()
  } catch (error) {
    console.error("Error initializing Paystack payment:", error)
    throw error
  }
}

async function verifyPaystackPayment(reference) {
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    })
    return await response.json()
  } catch (error) {
    console.error("Error verifying Paystack payment:", error)
    throw error
  }
}

// Hubnet Integration
async function checkHubnetBalance() {
  try {
    const response = await fetch("https://console.hubnet.app/live/api/context/business/transaction/check_balance", {
      method: "GET",
      headers: {
        token: `Bearer ${HUBNET_API_KEY}`,
        "Content-Type": "application/json",
      },
    })
    return await response.json()
  } catch (error) {
    console.error("Error checking Hubnet balance:", error)
    throw error
  }
}

async function processHubnetTransaction(payload) {
  try {
    const response = await fetch(
      "https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction",
      {
        method: "POST",
        headers: {
          token: `Bearer ${HUBNET_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    )
    return await response.json()
  } catch (error) {
    console.error("Error processing Hubnet transaction:", error)
    throw error
  }
}

// Routes

// Initiate Payment
app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email } = req.body
  if (!network || !phone || !volume || !amount || !email) {
    return res.status(400).json({ status: "error", message: "Missing required payment data." })
  }

  const reference = generateReference()
  createTransaction(reference, { network, phone, volume, amount, email, status: STATUS.INITIATED })

  try {
    const amountInKobo = Math.round(amount * 100)
    const payload = {
      amount: amountInKobo,
      email,
      reference,
      metadata: { network, phone, volume },
    }

    const data = await initializePaystackPayment(payload)
    if (!data.status || !data.data) {
      throw new Error("Failed to initialize payment: " + (data.message || "Unknown error"))
    }

    updateTransaction(reference, { paystackData: data.data })
    return res.json({ status: "success", data: data.data })
  } catch (error) {
    console.error("Error initializing Paystack payment:", error)
    return res.status(500).json({ status: "error", message: "Failed to initialize payment. Please try again." })
  }
})

// Check Payment Status
app.get("/api/check-payment-status/:reference", async (req, res) => {
  const { reference } = req.params
  if (!reference) {
    return res.status(400).json({ status: "error", message: "Missing payment reference." })
  }

  try {
    const verifyData = await verifyPaystackPayment(reference)

    if (!verifyData.status) {
      return res.json({ status: "pending", message: "Payment not yet completed." })
    }

    if (verifyData.data.status === "success") {
      const transaction = getTransactionByReference(reference)
      if (transaction) {
        // Process Hubnet transaction
        const hubnetPayload = {
          phone: transaction.phone,
          volume: transaction.volume.toString(),
          reference,
          referrer: transaction.phone,
        }
        const hubnetData = await processHubnetTransaction(hubnetPayload)

        if (hubnetData.status && hubnetData.data && hubnetData.data.code === "0000") {
          updateTransaction(reference, { status: STATUS.COMPLETED })
          return res.json({ status: "success", message: "Transaction completed successfully." })
        } else {
          updateTransaction(reference, { status: STATUS.ERROR })
          return res.json({ status: "error", message: "Failed to process data bundle." })
        }
      } else {
        return res.json({ status: "error", message: "Transaction not found." })
      }
    } else {
      return res.json({ status: "pending", message: "Payment not yet completed." })
    }
  } catch (error) {
    console.error("Error checking payment status:", error)
    return res.status(500).json({ status: "error", message: "Failed to check payment status. Please try again." })
  }
})

// Check Hubnet Balance
app.get("/api/check-balance", async (req, res) => {
  try {
    const balanceData = await checkHubnetBalance()
    res.json(balanceData)
  } catch (error) {
    console.error("Error checking Hubnet balance:", error)
    res.status(500).json({ status: "error", message: "Failed to check balance" })
  }
})

// Track Order
app.get("/api/track-order", async (req, res) => {
  const { reference } = req.query
  if (!reference) {
    return res.status(400).json({ status: "error", message: "Missing order reference" })
  }

  try {
    // Check Paystack transaction status
    const paystackData = await verifyPaystackPayment(reference)

    if (paystackData.status && paystackData.data) {
      const orderData = {
        reference: paystackData.data.reference,
        amount: paystackData.data.amount / 100, // Convert from kobo to naira
        status: paystackData.data.status,
        phone: paystackData.data.metadata.phone,
        volume: paystackData.data.metadata.volume,
        timestamp: new Date(paystackData.data.paid_at).getTime(),
      }

      return res.json({ status: "success", data: orderData })
    } else {
      return res.status(404).json({ status: "error", message: "Order not found" })
    }
  } catch (error) {
    console.error("Error tracking order:", error)
    return res.status(500).json({ status: "error", message: "Failed to track order" })
  }
})

app.use(errorHandler)

app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`)
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY))
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY))
  console.log("🔑 Paystack Public Key configured:", Boolean(PAYSTACK_PUBLIC_KEY))
})

