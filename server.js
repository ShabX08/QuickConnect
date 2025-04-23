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

// Create a log directory if it doesn't exist
const logDir = path.join(__dirname, "logs")
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

/**
 * Log transactions for debugging and auditing
 * @param {string} type - Type of log entry
 * @param {Object} data - Data to log
 */
function logTransaction(type, data) {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      type,
      data
    }
    
    console.log(`[${timestamp}] [${type}]`, JSON.stringify(data))
    
    // Save logs to a file
    const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}-transactions.log`)
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n')
  } catch (error) {
    console.error("Error logging transaction:", error)
  }
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
    logTransaction("PAYSTACK_INIT_REQUEST", payload)

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()
    
    logTransaction("PAYSTACK_INIT_RESPONSE", data)
    
    if (!response.ok) {
      throw new Error(`Paystack error: ${data.message || response.statusText}`)
    }

    return data
  } catch (error) {
    logTransaction("PAYSTACK_INIT_ERROR", { error: error.message })
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
    logTransaction("PAYSTACK_VERIFY_REQUEST", { reference })

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Cache-Control": "no-cache",
      },
    })

    const data = await response.json()
    
    logTransaction("PAYSTACK_VERIFY_RESPONSE", data)
    
    if (!response.ok) {
      throw new Error(`Paystack verification error: ${data.message || response.statusText}`)
    }

    return data
  } catch (error) {
    logTransaction("PAYSTACK_VERIFY_ERROR", { reference, error: error.message })
    throw error
  }
}

/**
 * Check Hubnet account balance
 * @returns {Promise<Object>} Balance information
 */
async function checkHubnetBalance() {
  try {
    logTransaction("HUBNET_BALANCE_REQUEST", {})

    const response = await fetch("https://console.hubnet.app/live/api/context/business/transaction/check_balance", {
      method: "GET",
      headers: {
        token: `Bearer ${HUBNET_API_KEY}`,
        "Content-Type": "application/json",
      },
    })

    // Get response as text first to handle potential JSON parsing errors
    const responseText = await response.text()
    let data
    
    try {
      data = JSON.parse(responseText)
      logTransaction("HUBNET_BALANCE_RESPONSE", data)
    } catch (e) {
      logTransaction("HUBNET_BALANCE_PARSE_ERROR", { responseText, error: e.message })
      throw new Error(`Invalid response from Hubnet API: ${responseText}`)
    }

    if (!response.ok) {
      throw new Error(`Hubnet balance check error: ${data.message || data.reason || response.statusText}`)
    }

    return data
  } catch (error) {
    logTransaction("HUBNET_BALANCE_ERROR", { error: error.message })
    throw error
  }
}

// Database of processed references to prevent duplicates
// In a production environment, this should be replaced with a persistent database
const processedReferences = new Set()

/**
 * Validate Hubnet payload
 * @param {Object} payload - Payload to validate
 * @returns {Array|null} Array of errors or null if valid
 */
function validateHubnetPayload(payload) {
  const errors = []
  
  // Validate phone number (must be 10 digits)
  if (!payload.phone || !/^\d{10}$/.test(payload.phone)) {
    errors.push("Invalid phone number format. Must be 10 digits.")
  }
  
  // Validate volume (must be a number or string number)
  const volumeNum = Number(payload.volume)
  if (isNaN(volumeNum) || volumeNum <= 0) {
    errors.push("Invalid volume. Must be a positive number.")
  }
  
  // Validate reference (must be 6-25 characters)
  if (!payload.reference || payload.reference.length < 6 || payload.reference.length > 25) {
    errors.push("Invalid reference. Must be between 6 and 25 characters.")
  }
  
  return errors.length > 0 ? errors : null
}

/**
 * Process Hubnet transaction for data bundle with retry mechanism
 * @param {Object} payload - Transaction payload
 * @param {string} network - Network code (mtn, at, big-time)
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<Object>} Hubnet response
 */
async function processHubnetTransactionWithRetry(payload, network, maxRetries = 3) {
  let lastError
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // If this is a retry attempt, log it
      if (attempt > 1) {
        logTransaction("HUBNET_RETRY", { 
          attempt, 
          maxRetries, 
          reference: payload.reference,
          network
        })
      }
      
      return await processHubnetTransaction(payload, network)
    } catch (error) {
      lastError = error
      
      logTransaction("HUBNET_ATTEMPT_FAILED", { 
        attempt, 
        error: error.message,
        reference: payload.reference,
        network
      })
      
      // Don't retry for validation errors
      if (error.message.includes("Invalid network") || 
          error.message.includes("Invalid volume") ||
          error.message.includes("Invalid phone")) {
        break
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s, etc.
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError || new Error("Failed to process Hubnet transaction after multiple attempts")
}

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
      logTransaction("HUBNET_ALREADY_PROCESSED", { reference: payload.reference })
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

    // Validate payload
    const validationErrors = validateHubnetPayload(payload)
    if (validationErrors) {
      logTransaction("HUBNET_VALIDATION_ERROR", { payload, errors: validationErrors })
      throw new Error(`Validation errors: ${validationErrors.join(", ")}`)
    }

    // Ensure volume is a string as required by API
    if (typeof payload.volume !== 'string') {
      payload.volume = payload.volume.toString()
    }

    // Add webhook URL for transaction status updates if not present
    if (!payload.webhook) {
      payload.webhook = `${BASE_URL}/api/webhooks/hubnet-callback`
    }

    logTransaction("HUBNET_TRANSACTION_REQUEST", { payload, network })

    const response = await fetch(
      `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`,
      {
        method: "POST",
        headers: {
          token: `Bearer ${HUBNET_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    )

    // Get response as text first to handle potential JSON parsing errors
    const responseText = await response.text()
    let data
    
    try {
      data = JSON.parse(responseText)
      logTransaction("HUBNET_TRANSACTION_RESPONSE", data)
    } catch (e) {
      logTransaction("HUBNET_PARSE_ERROR", { responseText, error: e.message })
      throw new Error(`Invalid response from Hubnet API: ${responseText}`)
    }

    // Check for specific error codes from Hubnet API
    if (!data.status) {
      const errorCode = data.code || 'unknown'
      const errorMessage = data.message || 'Unknown error'
      
      logTransaction("HUBNET_ERROR", { errorCode, errorMessage, data })
      
      if (errorCode === '1001') {
        throw new Error(`Invalid network: ${network}`)
      } else if (errorCode === '1002') {
        throw new Error(`Invalid volume: ${payload.volume}`)
      } else {
        throw new Error(`Hubnet API error: ${errorMessage}`)
      }
    }

    // Validate successful response
    if (data.status && data.code === '0000') {
      // Mark this reference as processed
      processedReferences.add(payload.reference)
      return data
    } else {
      logTransaction("HUBNET_UNEXPECTED_RESPONSE", data)
      throw new Error(`Unexpected response from Hubnet: ${data.message || JSON.stringify(data)}`)
    }
  } catch (error) {
    logTransaction("HUBNET_TRANSACTION_ERROR", { error: error.message, payload, network })
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
 * Hubnet API health check endpoint
 * Checks if the Hubnet API is responding correctly
 */
app.get("/api/hubnet-health", async (req, res) => {
  try {
    const balanceData = await checkHubnetBalance()
    
    return res.json({
      status: "healthy",
      message: "Hubnet API is responding correctly",
      balance: balanceData.balance || "N/A",
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return res.status(503).json({
      status: "unhealthy",
      message: "Hubnet API is not responding correctly",
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
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
    logTransaction("BALANCE_CHECK_ERROR", { error: error.message })
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
    logTransaction("PAYMENT_INIT_ERROR", { error: error.message, request: req.body })
    return res.status(500).json({
      status: "error",
      message: "Failed to initialize payment. Please try again or contact support.",
      error: error.message,
    })
  }
})

// Track references that have been verified to prevent duplicate processing
const verifiedReferences = new Set()

/**
 * Verify payment endpoint
 * Verifies payment and processes data bundle when payment is successful
 */
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
    logTransaction("PAYMENT_ALREADY_VERIFIED", { reference })
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
        volume: volume.toString(), // Ensure volume is a string as required by API
        reference,
        referrer: phone, // Using customer's phone as referrer to receive completion alerts
        webhook: `${BASE_URL}/api/webhooks/hubnet-callback` // Add webhook for status updates
      }

      try {
        // Process data bundle with Hubnet using retry mechanism
        const hubnetData = await processHubnetTransactionWithRetry(hubnetPayload, network)

        // Mark this reference as verified
        verifiedReferences.add(reference)

        // Return success response
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
            transaction_id: hubnetData.transaction_id || hubnetData.data?.transaction_id || "N/A",
            hubnetResponse: hubnetData,
          },
        })
      } catch (hubnetError) {
        logTransaction("HUBNET_ERROR_AFTER_PAYMENT", { 
          reference, 
          error: hubnetError.message,
          paymentData: {
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            network: verifyData.data.metadata.network,
          }
        })

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
    logTransaction("PAYMENT_VERIFICATION_ERROR", { reference, error: error.message })
    return res.status(500).json({
      status: "error",
      message: "Failed to verify payment. Please try again or contact support.",
      error: error.message,
    })
  }
})

/**
 * Webhook endpoint for Hubnet callbacks
 * Receives transaction status updates from Hubnet
 */
app.post("/api/webhooks/hubnet-callback", express.json(), async (req, res) => {
  try {
    logTransaction("HUBNET_WEBHOOK", req.body)
    
    const { reference, status, transaction_id } = req.body
    
    if (!reference) {
      return res.status(400).json({ status: "error", message: "Missing reference" })
    }
    
    // Here you would update your database with the transaction status
    // For example, using Firebase or another database
    
    // Always respond with 200 OK to acknowledge receipt
    return res.status(200).json({ 
      status: "success", 
      message: "Webhook received",
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logTransaction("HUBNET_WEBHOOK_ERROR", { error: error.message, body: req.body })
    return res.status(500).json({ status: "error", message: "Internal server error" })
  }
})

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  logTransaction("UNHANDLED_ERROR", { error: err.stack, path: req.path, method: req.method })
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
