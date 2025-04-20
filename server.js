import express from "express"
import cors from "cors"
import fetch from "node-fetch"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"
import fs from "fs"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${port}`
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`

app.use(cors())
app.use(express.json())

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, "public")
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true })
}

// Create a basic index.html file if it doesn't exist
const indexPath = path.join(publicDir, "index.html")
if (!fs.existsSync(indexPath)) {
  const basicHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PBM DATA HUB API</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #2563eb;
    }
    .endpoint {
      background-color: #f1f5f9;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .method {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: bold;
      margin-right: 10px;
    }
    .post {
      background-color: #10b981;
      color: white;
    }
    .get {
      background-color: #3b82f6;
      color: white;
    }
  </style>
</head>
<body>
  <h1>PBM DATA HUB API</h1>
  <p>Welcome to the PBM DATA HUB API. This server provides endpoints for MTN and Airtel Tigo data bundle services.</p>
  
  <h2>Available Endpoints:</h2>
  
  <div class="endpoint">
    <div><span class="method post">POST</span> /api/initiate-payment</div>
    <p>Initiates a payment transaction with Paystack for data bundle purchase.</p>
  </div>
  
  <div class="endpoint">
    <div><span class="method get">GET</span> /api/verify-payment/:reference</div>
    <p>Verifies a payment transaction and processes the data bundle if payment is successful.</p>
  </div>
  
  <div class="endpoint">
    <div><span class="method get">GET</span> /api/check-balance</div>
    <p>Checks the current balance for the service provider account.</p>
  </div>
  
  <p>For more information, please refer to the API documentation or contact support.</p>
</body>
</html>
  `
  fs.writeFileSync(indexPath, basicHtml)
}

// Serve static files from the public directory
app.use(express.static(publicDir))

// Required API keys
const HUBNET_API_KEY = process.env.HUBNET_API_KEY
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY

// Validate required environment variables
if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY) {
  console.error("Missing required environment variables. Please check your .env file.")
  console.error("HUBNET_API_KEY:", Boolean(HUBNET_API_KEY))
  console.error("PAYSTACK_SECRET_KEY:", Boolean(PAYSTACK_SECRET_KEY))
}

/**
 * Generate a unique transaction reference
 * @param {string} prefix - Prefix for the reference (e.g., MTN_DATA, AT_DATA)
 * @returns {string} Unique reference ID
 */
function generateReference(prefix = "DATA") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`
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
 * Check Hubnet account balance
 * @returns {Promise<Object>} Balance information
 */
async function checkHubnetBalance() {
  try {
    console.log("Checking Hubnet account balance")

    const response = await fetch("https://console.hubnet.app/live/api/context/business/transaction/check_balance", {
      method: "GET",
      headers: {
        token: `Bearer ${HUBNET_API_KEY}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Hubnet balance check error response:", errorText)
      try {
        const errorData = JSON.parse(errorText)
        throw new Error(`Hubnet balance check error: ${errorData.message || errorData.reason || response.statusText}`)
      } catch (e) {
        throw new Error(`Hubnet balance check error: ${response.statusText}. Status code: ${response.status}`)
      }
    }

    const data = await response.json()
    console.log("Hubnet balance check result:", data)
    return data
  } catch (error) {
    console.error("Error checking Hubnet balance:", error)
    throw error
  }
}

// Track processed references to prevent duplicates
const processedReferences = new Set()

/**
 * Process Hubnet transaction for data bundle
 * @param {Object} payload - Transaction payload
 * @param {string} network - Network code (mtn, at, big-time)
 * @returns {Promise<Object>} Hubnet response
 */
async function processHubnetTransaction(payload, network) {
  try {
    // Check if this reference has already been processed
    if (processedReferences.has(payload.reference)) {
      console.log(`Reference ${payload.reference} has already been processed, skipping Hubnet transaction`)
      return {
        status: true,
        reason: "Already processed",
        code: "transaction already processed",
        message: "0000",
        transaction_id: `TXN-${payload.reference}`,
        reference: payload.reference,
        data: {
          status: true,
          code: "0000",
          message: "Order already processed.",
        },
      }
    }

    console.log(`Processing Hubnet transaction for ${network} with payload:`, JSON.stringify(payload))

    // Using the correct endpoint from the documentation
    const response = await fetch(
      `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`,
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

    // Mark this reference as processed
    processedReferences.add(payload.reference)

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

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  })
})

/**
 * Check balance endpoint
 * Returns the current balance for the service provider account
 */
app.get("/api/check-balance", async (req, res) => {
  try {
    const balanceData = await checkHubnetBalance()

    return res.json({
      status: "success",
      message: "Balance retrieved successfully",
      data: balanceData,
    })
  } catch (error) {
    console.error("Error in /api/check-balance:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve balance. Please try again or contact support.",
      error: error.message,
    })
  }
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

  // Validate network
  if (!["mtn", "at", "big-time"].includes(network)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid network. Supported networks are: mtn, at, big-time",
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
    const prefix = network === "mtn" ? "MTN_DATA" : network === "at" ? "AT_DATA" : "BT_DATA"
    const reference = generateReference(prefix)

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
            value: `${volume}MB for ${phone} (${network.toUpperCase()})`,
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

// Track references that have been verified to prevent duplicate processing
const verifiedReferences = new Set()

// Update the verify payment endpoint to always process data bundle when payment is successful
app.get("/api/verify-payment/:reference", async (req, res) => {
  const { reference } = req.params

  if (!reference) {
    return res.status(400).json({
      status: "error",
      message: "Missing payment reference.",
    })
  }

  // Check if this reference has already been verified
  if (verifiedReferences.has(reference)) {
    console.log(`Reference ${reference} has already been verified, returning cached result`)
    return res.json({
      status: "success",
      message: "Transaction was already processed successfully.",
      data: {
        reference: reference,
        alreadyProcessed: true,
      },
    })
  }

  try {
    // Verify payment with Paystack
    const verifyData = await verifyPaystackPayment(reference)

    if (!verifyData.status) {
      return res.json({
        status: "failed",
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
        const hubnetData = await processHubnetTransaction(hubnetPayload, network)

        // Mark this reference as verified
        verifiedReferences.add(reference)

        // Always return success for successful payments
        return res.json({
          status: "success",
          message: "Transaction completed successfully. Your data bundle has been processed.",
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            network: verifyData.data.metadata.network,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
            transaction_id: hubnetData.transaction_id || hubnetData.data.transaction_id || "N/A",
            hubnetResponse: hubnetData,
          },
        })
      } catch (hubnetError) {
        console.error("Error processing Hubnet transaction:", hubnetError)

        // Even if Hubnet fails, we should acknowledge the payment was successful
        // but mark the order status as pending for the user
        return res.json({
          status: "pending",
          paymentStatus: "success",
          hubnetStatus: "failed",
          message:
            "Your payment was successful, but there was an issue processing your data bundle. Our team will resolve this shortly.",
          error: hubnetError.message,
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            network: verifyData.data.metadata.network,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
          },
        })
      }
    } else if (verifyData.data.status === "pending") {
      return res.json({
        status: "pending",
        paymentStatus: "pending",
        message: "Payment is still being processed. Please check back later.",
      })
    } else if (verifyData.data.status === "failed") {
      // Return the failed status with the full data for better error handling
      return res.json({
        status: "failed",
        paymentStatus: "failed",
        message: "Payment failed or was cancelled.",
        data: verifyData.data,
      })
    } else {
      return res.json({
        status: "failed",
        paymentStatus: "failed",
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
