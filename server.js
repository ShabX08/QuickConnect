import express from "express"
import cors from "cors"
import fetch from "node-fetch"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${port}`
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

const HUBNET_API_KEY = process.env.HUBNET_API_KEY
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY

if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY) {
  console.error("Missing required environment variables. Please check your .env file.")
  process.exit(1)
}

function generateReference() {
  return `MTN_ALT_${crypto.randomBytes(8).toString("hex")}`
}

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
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
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
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error("Error verifying Paystack payment:", error)
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
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error("Error processing Hubnet transaction:", error)
    throw error
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email } = req.body
  if (!network || !phone || !volume || !amount || !email) {
    return res.status(400).json({ status: "error", message: "Missing required payment data." })
  }

  const reference = generateReference()

  try {
    const amountInKobo = Math.round(amount * 100)
    const payload = {
      amount: amountInKobo,
      email,
      reference,
      callback_url: `${FRONTEND_URL}`,
      metadata: { network, phone, volume },
    }

    const data = await initializePaystackPayment(payload)
    if (!data.status || !data.data) {
      throw new Error("Failed to initialize payment: " + (data.message || "Unknown error"))
    }

    return res.json({ status: "success", data: data.data })
  } catch (error) {
    console.error("Error initializing Paystack payment:", error)
    return res.status(500).json({ status: "error", message: "Failed to initialize payment. Please try again." })
  }
})

app.get("/api/verify-payment/:reference", async (req, res) => {
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
      // Process Hubnet transaction
      const hubnetPayload = {
        phone: verifyData.data.metadata.phone,
        volume: verifyData.data.metadata.volume.toString(),
        reference,
        referrer: verifyData.data.metadata.phone,
      }
      const hubnetData = await processHubnetTransaction(hubnetPayload)

      if (hubnetData.status && hubnetData.data && hubnetData.data.code === "0000") {
        return res.json({
          status: "success",
          message: "Transaction completed successfully.",
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
          },
        })
      } else {
        console.error("Hubnet transaction failed:", hubnetData)
        return res.json({ status: "error", message: "Failed to process data bundle." })
      }
    } else {
      return res.json({ status: "failed", message: "Payment failed or was cancelled." })
    }
  } catch (error) {
    console.error("Error verifying payment:", error)
    return res.status(500).json({ status: "error", message: "Failed to verify payment. Please try again." })
  }
})

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send("Something broke!")
})

app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`)
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY))
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY))
})
