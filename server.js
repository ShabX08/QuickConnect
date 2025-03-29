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

// Required API keys
const HUBNET_API_KEY = process.env.HUBNET_API_KEY
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY

// Validate required environment variables
if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY) {
  console.error("Missing required environment variables. Please check your .env file.")
  process.exit(1)
}

/**
 * Generate a unique transaction reference
 * @returns {string} Unique reference ID
 */
function generateReference() {
  return `MTN_DATA_${crypto.randomBytes(8).toString("hex")}`
}

/**
 * Initialize Paystack payment
 * @param {Object} payload - Payment payload
 * @returns {Promise<Object>} Paystack response
 */
async function initializePaystackPayment(payload) {
  try {
    console.log("Initializing Paystack payment with payload:", JSON.stringify(payload))

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error("Paystack error response:", errorData)
      throw new Error(`Paystack error: ${errorData.message || response.statusText}`)
    }

    const data = await response.json()
    console.log("Paystack initialization successful:", data)
    return data
  } catch (error) {
    console.error("Error initializing Paystack payment:", error)
    throw error
  }
}

/**
 * Verify Paystack payment
 * @param {string} reference - Payment reference
 * @returns {Promise<Object>} Verification response
 */
async function verifyPaystackPayment(reference) {
  try {
    console.log(`Verifying Paystack payment with reference: ${reference}`)

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Cache-Control": "no-cache",
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error("Paystack verification error:", errorData)
      throw new Error(`Paystack verification error: ${errorData.message || response.statusText}`)
    }

    const data = await response.json()
    console.log("Paystack verification result:", data)
    return data
  } catch (error) {
    console.error("Error verifying Paystack payment:", error)
    throw error
  }
}

/**
 * Process Hubnet transaction for data bundle
 * @param {Object} payload - Transaction payload
 * @returns {Promise<Object>} Hubnet response
 */
async function processHubnetTransaction(payload) {
  try {
    console.log("Processing Hubnet transaction with payload:", JSON.stringify(payload))

    // Using the correct endpoint from the documentation
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
      const errorText = await response.text()
      console.error("Hubnet API error response:", errorText)
      try {
        const errorData = JSON.parse(errorText)
        throw new Error(`Hubnet API error: ${errorData.message || errorData.reason || response.statusText}`)
      } catch (e) {
        throw new Error(`Hubnet API error: ${response.statusText}. Status code: ${response.status}`)
      }
    }

    const data = await response.json()
    console.log("Hubnet transaction result:", data)
    return data
  } catch (error) {
    console.error("Error processing Hubnet transaction:", error)
    throw error
  }
}

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

/**
 * Initiate payment endpoint
 * Starts the payment process with Paystack
 */
app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email, fcmToken } = req.body

  // Validate required fields
  if (!network || !phone || !volume || !amount || !email) {
    return res.status(400).json({
      status: "error",
      message: "Missing required payment data. Please provide network, phone, volume, amount, and email.",
    })
  }

  // Validate phone number format
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid phone number format. Please provide a 10-digit phone number.",
    })
  }

  try {
    // Generate a unique reference for this transaction
    const reference = generateReference()

    // Convert amount to kobo (Paystack uses the smallest currency unit)
    const amountInKobo = Math.round(amount * 100)

    // Prepare Paystack payload
    const payload = {
      amount: amountInKobo,
      email,
      reference,
      callback_url: `${FRONTEND_URL}`,
      metadata: {
        network,
        phone,
        volume,
        fcmToken: fcmToken || null,
        custom_fields: [
          {
            display_name: "Data Bundle",
            variable_name: "data_bundle",
            value: `${volume}MB for ${phone}`,
          },
        ],
      },
    }

    // Initialize payment with Paystack
    const data = await initializePaystackPayment(payload)

    if (!data.status || !data.data) {
      throw new Error("Failed to initialize payment: " + (data.message || "Unknown error"))
    }

    return res.json({
      status: "success",
      message: "Payment initialized successfully",
      data: data.data,
    })
  } catch (error) {
    console.error("Error in /api/initiate-payment:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to initialize payment. Please try again or contact support.",
      error: error.message,
    })
  }
})

/**
 * Verify payment endpoint
 * Checks payment status and processes data bundle if payment is successful
 */
app.get("/api/verify-payment/:reference", async (req, res) => {
  const { reference } = req.params

  if (!reference) {
    return res.status(400).json({
      status: "error",
      message: "Missing payment reference.",
    })
  }

  try {
    // Verify payment with Paystack
    const verifyData = await verifyPaystackPayment(reference)

    if (!verifyData.status) {
      return res.json({
        status: "pending",
        message: "Payment verification failed. Please try again.",
      })
    }

    // Check if payment is successful
    if (verifyData.data.status === "success") {
      // Extract metadata from verified payment
      const { phone, volume, network } = verifyData.data.metadata

      // Prepare Hubnet payload according to documentation
      const hubnetPayload = {
        phone,
        volume: volume.toString(),
        reference,
        referrer: phone, // Using customer's phone as referrer
      }

      try {
        // Process data bundle with Hubnet
        const hubnetData = await processHubnetTransaction(hubnetPayload)

        // Check if Hubnet transaction was successful
        if (hubnetData.status && hubnetData.data && hubnetData.data.code === "0000") {
          return res.json({
            status: "success",
            message: "Transaction completed successfully. Your data bundle has been processed.",
            data: {
              reference: verifyData.data.reference,
              amount: verifyData.data.amount / 100,
              phone: verifyData.data.metadata.phone,
              volume: verifyData.data.metadata.volume,
              timestamp: new Date(verifyData.data.paid_at).getTime(),
              transaction_id: hubnetData.transaction_id || hubnetData.data.transaction_id || "N/A",
            },
          })
        } else {
          console.error("Hubnet transaction failed:", hubnetData)
          return res.json({
            status: "processing",
            message:
              "Payment successful but data bundle processing is pending. Please contact support if not received within 2 hours.",
            reference: reference,
          })
        }
      } catch (hubnetError) {
        console.error("Error processing Hubnet transaction:", hubnetError)

        // Even if Hubnet fails, we should acknowledge the payment was successful
        return res.json({
          status: "payment_success",
          message:
            "Payment successful but there was an issue processing your data bundle. Our team will resolve this shortly.",
          reference: reference,
          error: hubnetError.message,
        })
      }
    } else if (verifyData.data.status === "pending") {
      return res.json({
        status: "pending",
        message: "Payment is still being processed. Please check back later.",
      })
    } else {
      return res.json({
        status: "failed",
        message: "Payment failed or was cancelled.",
      })
    }
  } catch (error) {
    console.error("Error verifying payment:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to verify payment. Please try again or contact support.",
      error: error.message,
    })
  }
})

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack)
  res.status(500).json({
    status: "error",
    message: "An unexpected error occurred. Please try again or contact support.",
    error: process.env.NODE_ENV === "production" ? undefined : err.message,
  })
})

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`)
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY))
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY))
})

