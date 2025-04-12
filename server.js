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

// Add network-specific configurations
const NETWORKS = {
  mtn: {
    name: "MTN",
    endpoint: "mtn-new-transaction",
    description: "MTN Data Bundle",
  },
  at: {
    name: "AirtelTigo",
    endpoint: "at-new-transaction",
    description: "AirtelTigo Data Bundle",
  },
}

// In-memory transaction cache to prevent duplicate processing
// In a production environment, this should be replaced with a database
const processedTransactions = new Map()

app.use(cors())
app.use(express.json())

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, "public")
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true })
}

// Create a transaction log directory
const logsDir = path.join(__dirname, "logs")
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
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
  <p>Welcome to the PBM DATA HUB API. This server provides endpoints for MTN and AirtelTigo data bundle services.</p>
  
  <h2>Available Endpoints:</h2>
  
  <div class="endpoint">
    <div><span class="method post">POST</span> /api/initiate-payment</div>
    <p>Initiates a payment transaction with Paystack for data bundle purchase.</p>
  </div>
  
  <div class="endpoint">
    <div><span class="method get">GET</span> /api/verify-payment/:reference</div>
    <p>Verifies a payment transaction and processes the data bundle if payment is successful.</p>
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
 * Log transaction to file
 * @param {string} type - Type of transaction (initiate, verify, hubnet)
 * @param {string} reference - Transaction reference
 * @param {Object} data - Transaction data
 */
function logTransaction(type, reference, data) {
  try {
    const logFile = path.join(logsDir, `transactions-${new Date().toISOString().split("T")[0]}.log`)
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      reference,
      data,
    }

    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n")
  } catch (error) {
    console.error("Error logging transaction:", error)
  }
}

/**
 * Check if a transaction has already been processed
 * @param {string} reference - Transaction reference
 * @returns {boolean} True if already processed
 */
function isTransactionProcessed(reference) {
  return processedTransactions.has(reference)
}

/**
 * Mark a transaction as processed
 * @param {string} reference - Transaction reference
 * @param {Object} data - Transaction data
 */
function markTransactionProcessed(reference, data) {
  processedTransactions.set(reference, {
    timestamp: Date.now(),
    data,
  })

  // Log the transaction
  logTransaction("processed", reference, data)

  // Clean up old transactions (older than 24 hours)
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  for (const [ref, details] of processedTransactions.entries()) {
    if (now - details.timestamp > oneDayMs) {
      processedTransactions.delete(ref)
    }
  }
}

/**
 * Generate a unique transaction reference
 * @param {string} network - Network code (mtn, at)
 * @returns {string} Unique reference ID
 */
function generateReference(network = "mtn") {
  const prefix = network.toUpperCase()
  const timestamp = Date.now().toString().slice(-6)
  const randomBytes = crypto.randomBytes(6).toString("hex")
  return `${prefix}_DATA_${timestamp}_${randomBytes}`
}

/**
 * Initialize Paystack payment
 * @param {Object} payload - Payment payload
 * @returns {Promise<Object>} Paystack response
 */
async function initializePaystackPayment(payload) {
  try {
    console.log("Initializing Paystack payment with payload:", JSON.stringify(payload))
    logTransaction("paystack-init", payload.reference, payload)

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
      logTransaction("paystack-error", payload.reference, errorData)
      throw new Error(`Paystack error: ${errorData.message || response.statusText}`)
    }

    const data = await response.json()
    console.log("Paystack initialization successful:", data)
    logTransaction("paystack-success", payload.reference, data)
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
    logTransaction("paystack-verify", reference, { status: "verifying" })

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Cache-Control": "no-cache",
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error("Paystack verification error:", errorData)
      logTransaction("paystack-verify-error", reference, errorData)
      throw new Error(`Paystack verification error: ${errorData.message || response.statusText}`)
    }

    const data = await response.json()
    console.log("Paystack verification result:", data)
    logTransaction("paystack-verify-success", reference, data)
    return data
  } catch (error) {
    console.error("Error verifying Paystack payment:", error)
    throw error
  }
}

/**
 * Process Hubnet transaction for data bundle
 * @param {Object} payload - Transaction payload
 * @param {string} network - Network code (mtn, at)
 * @returns {Promise<Object>} Hubnet response
 */
async function processHubnetTransaction(payload, network = "mtn") {
  try {
    // Check if this transaction has already been processed
    if (isTransactionProcessed(payload.reference)) {
      console.log(`Transaction ${payload.reference} already processed. Preventing duplicate.`)
      return {
        status: true,
        reason: "Already Processed",
        code: "0000",
        message: "Transaction already processed successfully.",
        transaction_id: processedTransactions.get(payload.reference).data.transaction_id || "DUPLICATE",
        reference: payload.reference,
        data: {
          status: true,
          code: "0000",
          message: "Order already processed. Preventing duplicate.",
        },
      }
    }

    console.log(`Processing Hubnet transaction for ${network} with payload:`, JSON.stringify(payload))
    logTransaction("hubnet-init", payload.reference, { network, payload })

    // Get the correct endpoint for the network
    const endpoint = NETWORKS[network]?.endpoint || "mtn-new-transaction"

    // Using the correct endpoint from the documentation
    const response = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/${endpoint}`, {
      method: "POST",
      headers: {
        token: `Bearer ${HUBNET_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Hubnet API error response:", errorText)
      logTransaction("hubnet-error", payload.reference, { errorText, status: response.status })

      try {
        const errorData = JSON.parse(errorText)
        throw new Error(`Hubnet API error: ${errorData.message || errorData.reason || response.statusText}`)
      } catch (e) {
        throw new Error(`Hubnet API error: ${response.statusText}. Status code: ${response.status}`)
      }
    }

    const data = await response.json()
    console.log(`Hubnet transaction result for ${network}:`, data)
    logTransaction("hubnet-success", payload.reference, data)

    // Mark this transaction as processed to prevent duplicates
    if (data.status && data.data && data.data.code === "0000") {
      markTransactionProcessed(payload.reference, data)
    }

    return data
  } catch (error) {
    console.error(`Error processing Hubnet transaction for ${network}:`, error)
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
    processedTransactions: processedTransactions.size,
  })
})

// Add a specific route for AirtelTigo orders
app.get("/api/at-bundles", (req, res) => {
  // Return AirtelTigo specific bundle information
  const atBundles = [
    { volume: 1000, price: 5.5 },
    { volume: 2000, price: 10.5 },
    { volume: 3000, price: 14.0 },
    { volume: 4000, price: 19.0 },
    { volume: 5000, price: 23.5 },
    { volume: 6000, price: 28.0 },
  ]

  res.json({
    status: "success",
    message: "AirtelTigo bundles retrieved successfully",
    data: {
      bundles: atBundles,
      network: "at",
      networkName: "AirtelTigo",
      description: "AirtelTigo Data Bundle",
      validity: "30 days",
    },
  })
})

// Add a route to verify if a number is an AirtelTigo number
app.post("/api/verify-at-number", (req, res) => {
  const { phone } = req.body

  if (!phone) {
    return res.status(400).json({
      status: "error",
      message: "Phone number is required",
    })
  }

  // This is a simplified check - in a real app, you would use a more sophisticated method
  // to verify if a number belongs to AirtelTigo network
  const isATNumber =
    phone.startsWith("026") || phone.startsWith("027") || phone.startsWith("057") || phone.startsWith("059")

  if (isATNumber) {
    return res.json({
      status: "success",
      message: "Valid AirtelTigo number",
      data: { isValid: true, network: "at" },
    })
  } else {
    return res.json({
      status: "error",
      message: "This does not appear to be an AirtelTigo number",
      data: { isValid: false },
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
  if (!NETWORKS[network.toLowerCase()]) {
    return res.status(400).json({
      status: "error",
      message: `Invalid network. Supported networks are: ${Object.keys(NETWORKS).join(", ")}`,
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
    const reference = generateReference(network)

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
            value: `${volume}MB ${NETWORKS[network.toLowerCase()].name} for ${phone}`,
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
    // Check if this transaction has already been fully processed
    if (isTransactionProcessed(reference)) {
      console.log(`Payment ${reference} already fully processed. Returning cached result.`)
      const cachedData = processedTransactions.get(reference).data

      return res.json({
        status: "success",
        message: "Transaction already completed successfully.",
        data: {
          reference: reference,
          amount: cachedData.amount || 0,
          phone: cachedData.phone || "",
          volume: cachedData.volume || "",
          network: cachedData.network || "Unknown",
          timestamp: cachedData.timestamp || Date.now(),
          transaction_id: cachedData.transaction_id || "CACHED",
          hubnetResponse: cachedData,
          cached: true,
        },
      })
    }

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

      // Validate network
      const networkCode = network.toLowerCase()
      if (!NETWORKS[networkCode]) {
        return res.json({
          status: "failed",
          message: `Invalid network: ${network}. Supported networks are: ${Object.keys(NETWORKS).join(", ")}`,
        })
      }

      // Prepare Hubnet payload according to documentation
      const hubnetPayload = {
        phone,
        volume: volume.toString(),
        reference,
        referrer: phone, // Using customer's phone as referrer
      }

      try {
        // Process data bundle with Hubnet
        const hubnetData = await processHubnetTransaction(hubnetPayload, networkCode)

        // Check if Hubnet transaction was successful
        if (hubnetData.status && hubnetData.data && hubnetData.data.code === "0000") {
          // Store successful transaction data
          const transactionData = {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            network: NETWORKS[networkCode].name,
            networkCode: networkCode,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
            transaction_id: hubnetData.transaction_id || hubnetData.data.transaction_id || "N/A",
            hubnetResponse: hubnetData,
          }

          // Mark as processed if not already done in processHubnetTransaction
          if (!isTransactionProcessed(reference)) {
            markTransactionProcessed(reference, transactionData)
          }

          return res.json({
            status: "success",
            message: `Transaction completed successfully. Your ${NETWORKS[networkCode].name} data bundle has been processed.`,
            data: transactionData,
          })
        } else {
          console.error(`Hubnet transaction failed for ${networkCode}:`, hubnetData)
          return res.json({
            status: "pending",
            paymentStatus: "success",
            hubnetStatus: "failed",
            message: `Payment successful but ${NETWORKS[networkCode].name} data bundle processing is pending. Please contact support if not received within 2 hours.`,
            reference: reference,
            data: {
              reference: verifyData.data.reference,
              amount: verifyData.data.amount / 100,
              phone: verifyData.data.metadata.phone,
              volume: verifyData.data.metadata.volume,
              network: NETWORKS[networkCode].name,
              timestamp: new Date(verifyData.data.paid_at).getTime(),
            },
            hubnetError: hubnetData,
          })
        }
      } catch (hubnetError) {
        console.error(`Error processing Hubnet transaction for ${networkCode}:`, hubnetError)

        // Even if Hubnet fails, we should acknowledge the payment was successful
        // but mark the order status as pending
        return res.json({
          status: "pending",
          paymentStatus: "success",
          hubnetStatus: "failed",
          message: `Payment successful but ${NETWORKS[networkCode].name} data bundle processing is pending. Please contact support if not received within 2 hours.`,
          reference: reference,
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            network: NETWORKS[networkCode].name,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
          },
          error: hubnetError.message,
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

// Endpoint to check transaction status directly
app.get("/api/transaction-status/:reference", (req, res) => {
  const { reference } = req.params

  if (!reference) {
    return res.status(400).json({
      status: "error",
      message: "Missing transaction reference.",
    })
  }

  if (isTransactionProcessed(reference)) {
    const transactionData = processedTransactions.get(reference)
    return res.json({
      status: "success",
      message: "Transaction found",
      data: {
        reference,
        processed: true,
        timestamp: transactionData.timestamp,
        details: transactionData.data,
      },
    })
  } else {
    return res.json({
      status: "not_found",
      message: "Transaction not found or not yet processed",
      data: {
        reference,
        processed: false,
      },
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
  console.log(
    "📱 Supported networks:",
    Object.keys(NETWORKS)
      .map((key) => NETWORKS[key].name)
      .join(", "),
  )
})
