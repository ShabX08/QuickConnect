import express from "express"
import cors from "cors"
import https from "https"
import dotenv from "dotenv"
import fetch from "node-fetch"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"
import fs from "fs"

// Load environment variables
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000
const PORT = process.env.PORT || 3000
const FRONTEND_URL = process.env.FRONTEND_URL || "https://gamerzhubgh.web.app"
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`

// In-memory transaction tracking
const pendingTransactions = new Map()
const processedReferences = new Set()

// CORS configuration - allow requests from the frontend
app.use(
  cors({
    origin: [FRONTEND_URL, "*"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  }),
)

// Body parsers
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

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
  <p>Welcome to the PBM DATA HUB API. This server provides endpoints for MTN data bundle services.</p>
  
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

// Transaction tracking to prevent duplicates
const processedPayments = new Map() // Stores processed payment references
const processedHubnetTransactions = new Map() // Stores processed Hubnet transactions
//const pendingTransactions = new Map() // Tracks transactions in progress

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
    // Check if we already verified this payment
    if (processedPayments.has(reference)) {
      console.log(`Using cached payment verification for reference: ${reference}`)
      return processedPayments.get(reference)
    }

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

    // Cache successful verifications
    if (data.status && data.data.status === "success") {
      processedPayments.set(reference, data)

      // Set expiry for cache (24 hours)
      setTimeout(
        () => {
          processedPayments.delete(reference)
        },
        24 * 60 * 60 * 1000,
      )
    }

    return data
  } catch (error) {
    console.error("Error verifying Paystack payment:", error)
    throw error
  }
}

/**
 * Process Hubnet transaction for data bundle
 * @param {Object} payload - Transaction payload
 * @param {string} reference - Payment reference
 * @returns {Promise<Object>} Hubnet response
 */
async function processHubnetTransaction(payload, reference) {
  try {
    // Generate a unique key for this Hubnet transaction
    const hubnetKey = `${payload.phone}_${payload.volume}_${reference}`

    // Check if we already processed this exact transaction
    if (processedHubnetTransactions.has(hubnetKey)) {
      console.log(`Using cached Hubnet transaction for key: ${hubnetKey}`)
      return processedHubnetTransactions.get(hubnetKey)
    }

    // Check if this transaction is currently being processed
    if (pendingTransactions.has(hubnetKey)) {
      console.log(`Hubnet transaction already in progress for key: ${hubnetKey}`)
      throw new Error("Transaction is already being processed. Please wait.")
    }

    // Mark this transaction as in progress
    pendingTransactions.set(hubnetKey, {
      timestamp: Date.now(),
      status: "processing",
    })

    try {
      console.log("Processing Hubnet transaction with payload:", JSON.stringify(payload))

      // Add idempotency key to prevent duplicates on Hubnet's side
      const enhancedPayload = {
        ...payload,
        idempotency_key: hubnetKey,
      }

      // Using the correct endpoint from the documentation
      const response = await fetch(
        "https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction",
        {
          method: "POST",
          headers: {
            token: `Bearer ${HUBNET_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(enhancedPayload),
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

      // Cache successful transactions
      if (data.status && data.data && data.data.code === "0000") {
        processedHubnetTransactions.set(hubnetKey, data)

        // Set expiry for cache (24 hours)
        setTimeout(
          () => {
            processedHubnetTransactions.delete(hubnetKey)
          },
          24 * 60 * 60 * 1000,
        )
      }

      return data
    } finally {
      // Always remove from pending transactions when done
      pendingTransactions.delete(hubnetKey)
    }
  } catch (error) {
    console.error("Error processing Hubnet transaction:", error)
    throw error
  }
}

// Helper function to make Paystack API requests
function paystackRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.paystack.co",
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }

    console.log(`Making ${method} request to Paystack: ${path}`)

    const req = https.request(options, (res) => {
      let responseData = ""

      res.on("data", (chunk) => {
        responseData += chunk
      })

      res.on("end", () => {
        try {
          const parsedData = JSON.parse(responseData)
          console.log("Paystack response status:", parsedData.status)
          resolve(parsedData)
        } catch (error) {
          console.error("Failed to parse Paystack response:", error)
          reject(new Error(`Failed to parse Paystack response: ${error.message}`))
        }
      })
    })

    req.on("error", (error) => {
      console.error("Paystack request error:", error)
      reject(new Error(`Paystack request failed: ${error.message}`))
    })

    if (data) {
      console.log("Sending data to Paystack:", {
        ...data,
        amount: data.amount,
        email: data.email,
      })
      req.write(JSON.stringify(data))
    }

    req.end()
  })
}

// Generate a unique transaction ID based on user and transaction details
function generateTransactionId(email, amount, tournamentId, registrationId) {
  return `${email}_${amount}_${tournamentId || "none"}_${registrationId || "none"}_${Date.now()}`
}

// Initialize payment with duplicate prevention
app.post("/api/payment/initialize", async (req, res) => {
  console.log("Payment initialization request received")

  try {
    const { email, amount, metadata, tournamentId, registrationId } = req.body

    if (!email || !amount) {
      console.log("Missing required fields:", { email, amount })
      return res.status(400).json({
        status: false,
        message: "Email and amount are required",
      })
    }

    // Create a unique identifier for this transaction attempt
    const transactionId = generateTransactionId(email, amount, tournamentId, registrationId)

    // Check if this exact transaction is already being processed
    if (pendingTransactions.has(transactionId)) {
      console.log("Duplicate transaction attempt detected:", transactionId)
      return res.status(409).json({
        status: false,
        message: "A similar transaction is already being processed. Please wait or check your payment status.",
      })
    }

    // Mark this transaction as pending
    pendingTransactions.set(transactionId, {
      timestamp: Date.now(),
      status: "pending",
    })

    // Convert amount to pesewa (Paystack uses pesewa for GHS, which is 1/100 of a Cedi)
    const amountInPesewa = Math.floor(Number.parseFloat(amount) * 100)

    // Construct callback URL with all necessary parameters
    const callbackUrl = `${FRONTEND_URL}/payment-callback.html?tournamentId=${tournamentId || ""}&registrationId=${registrationId || ""}`

    // Add idempotency key to metadata to prevent duplicate processing on Paystack's end
    const enhancedMetadata = {
      ...(metadata || {}),
      transaction_id: transactionId,
      idempotency_key: `${email}_${amountInPesewa}_${Date.now()}`,
    }

    const paymentData = {
      email,
      amount: amountInPesewa,
      currency: "GHS", // Explicitly set currency to Ghanaian Cedis
      metadata: enhancedMetadata,
      callback_url: callbackUrl,
    }

    console.log("Initializing payment with data:", {
      email: paymentData.email,
      amount: `${amountInPesewa} pesewas (${amount} GHS)`,
      callback_url: callbackUrl,
      transaction_id: transactionId,
    })

    const response = await paystackRequest("POST", "/transaction/initialize", paymentData)

    if (response.status) {
      // Store the reference for verification later
      pendingTransactions.set(transactionId, {
        timestamp: Date.now(),
        status: "initialized",
        reference: response.data.reference,
        amount: amountInPesewa,
        email,
      })

      // Set a cleanup timeout (30 minutes)
      setTimeout(
        () => {
          pendingTransactions.delete(transactionId)
        },
        30 * 60 * 1000,
      )
    } else {
      // If initialization failed, remove from pending
      pendingTransactions.delete(transactionId)
    }

    console.log("Payment initialization response:", {
      status: response.status,
      message: response.message,
      authorizationUrl: response.data?.authorization_url,
    })

    return res.status(200).json(response)
  } catch (error) {
    console.error("Payment initialization error:", error)
    return res.status(500).json({
      status: false,
      message: "Failed to initialize payment: " + error.message,
      error: error.message,
    })
  }
})

// Verify payment with duplicate verification prevention
app.get("/api/payment/verify", async (req, res) => {
  console.log("Payment verification request received")

  try {
    const { reference } = req.query

    if (!reference) {
      console.log("Missing reference parameter")
      return res.status(400).json({
        status: false,
        message: "Payment reference is required",
      })
    }

    // Check if this reference has already been successfully processed
    if (processedReferences.has(reference)) {
      console.log("Payment already verified successfully:", reference)
      return res.status(200).json({
        status: true,
        message: "Payment was previously verified successfully",
        data: {
          reference,
          status: "success",
          already_processed: true,
        },
      })
    }

    console.log("Verifying payment with reference:", reference)

    const response = await paystackRequest("GET", `/transaction/verify/${reference}`)

    console.log("Payment verification response:", {
      status: response.status,
      paymentStatus: response.data?.status,
      amount: response.data?.amount ? `${response.data.amount / 100} GHS` : "N/A",
      reference: response.data?.reference,
    })

    // If payment was successful, mark this reference as processed
    if (response.status && response.data?.status === "success") {
      processedReferences.add(reference)

      // Find and update the pending transaction if it exists
      for (const [id, txn] of pendingTransactions.entries()) {
        if (txn.reference === reference) {
          pendingTransactions.set(id, {
            ...txn,
            status: "completed",
          })

          // Set a cleanup timeout (keep for 1 hour for records)
          setTimeout(
            () => {
              pendingTransactions.delete(id)
            },
            60 * 60 * 1000,
          )

          break
        }
      }

      // Limit the size of processedReferences to prevent memory leaks
      if (processedReferences.size > 10000) {
        // Remove the oldest entries (convert to array, slice, convert back to set)
        const processedReferencesSet = new Set([...processedReferences].slice(-5000))
        processedReferences = processedReferencesSet
      }
    }

    return res.status(200).json(response)
  } catch (error) {
    console.error("Payment verification error:", error)
    return res.status(500).json({
      status: false,
      message: "Failed to verify payment: " + error.message,
      error: error.message,
    })
  }
})

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" })
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
    // Check for potential duplicate transactions (same phone, volume, amount within 5 minutes)
    const transactionKey = `${phone}_${volume}_${amount}`
    const now = Date.now()
    const recentTransactionWindow = 5 * 60 * 1000 // 5 minutes

    // Check pending transactions for potential duplicates
    for (const [key, transaction] of pendingTransactions.entries()) {
      if (key.startsWith(transactionKey) && now - transaction.timestamp < recentTransactionWindow) {
        return res.status(409).json({
          status: "error",
          message: "A similar transaction is already being processed. Please wait a few minutes before trying again.",
        })
      }
    }

    // Generate a unique reference for this transaction
    const reference = generateReference()

    // Convert amount to kobo (Paystack uses the smallest currency unit)
    const amountInKobo = Math.round(amount * 100)

    // Prepare Paystack payload with idempotency key to prevent duplicates
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
        idempotency_key: `${phone}_${volume}_${Date.now()}`, // Add idempotency key
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

  // Create a lock key for this verification process
  const verificationLockKey = `verify_${reference}`

  // Check if this verification is already in progress
  if (pendingTransactions.has(verificationLockKey)) {
    return res.json({
      status: "pending",
      message: "This payment is currently being verified. Please try again in a moment.",
    })
  }

  // Set verification lock
  pendingTransactions.set(verificationLockKey, {
    timestamp: Date.now(),
    status: "verifying",
  })

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

      // Create a unique key for this Hubnet transaction
      const hubnetKey = `${phone}_${volume}_${reference}`

      // Check if we already processed this transaction successfully
      if (processedHubnetTransactions.has(hubnetKey)) {
        const hubnetData = processedHubnetTransactions.get(hubnetKey)
        return res.json({
          status: "success",
          message: "Transaction was already completed successfully. Your data bundle has been processed.",
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
            timestamp: new Date(verifyData.data.paid_at).getTime(),
            transaction_id: hubnetData.transaction_id || hubnetData.data.transaction_id || "N/A",
            hubnetResponse: hubnetData,
            already_processed: true,
          },
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
        const hubnetData = await processHubnetTransaction(hubnetPayload, reference)

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
              hubnetResponse: hubnetData,
            },
          })
        } else {
          console.error("Hubnet transaction failed:", hubnetData)
          return res.json({
            status: "pending",
            paymentStatus: "success",
            hubnetStatus: "failed",
            message:
              "Payment successful but data bundle processing is pending. Please contact support if not received within 2 hours.",
            reference: reference,
            data: {
              reference: verifyData.data.reference,
              amount: verifyData.data.amount / 100,
              phone: verifyData.data.metadata.phone,
              volume: verifyData.data.metadata.volume,
              timestamp: new Date(verifyData.data.paid_at).getTime(),
            },
            hubnetError: hubnetData,
          })
        }
      } catch (hubnetError) {
        console.error("Error processing Hubnet transaction:", hubnetError)

        // Even if Hubnet fails, we should acknowledge the payment was successful
        // but mark the order status as pending
        return res.json({
          status: "pending",
          paymentStatus: "success",
          hubnetStatus: "failed",
          message:
            "Payment successful but data bundle processing is pending. Please contact support if not received within 2 hours.",
          reference: reference,
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            phone: verifyData.data.metadata.phone,
            volume: verifyData.data.metadata.volume,
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
  } finally {
    // Always remove the verification lock
    pendingTransactions.delete(verificationLockKey)
  }
})

// Root path - just return a simple JSON response
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "GamerzHub Payment Server is running",
    endpoints: [
      { method: "POST", path: "/api/payment/initialize", description: "Initialize a payment" },
      { method: "GET", path: "/api/payment/verify", description: "Verify a payment" },
      { method: "GET", path: "/api/health", description: "Health check" },
    ],
  })
})

// Maintenance endpoint to view pending transactions (protected in production)
if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug/transactions", (req, res) => {
    res.json({
      pendingCount: pendingTransactions.size,
      processedCount: processedReferences.size,
      pending: Object.fromEntries(pendingTransactions),
    })
  })
}

// Debug endpoint to view transaction status (disabled in production)
if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug/transactions", (req, res) => {
    res.json({
      pendingCount: pendingTransactions.size,
      processedPaymentsCount: processedPayments.size,
      processedHubnetCount: processedHubnetTransactions.size,
      pending: Object.fromEntries(pendingTransactions),
    })
  })
}

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

// Start server
app.listen(PORT, () => {
  console.log(`Payment server running on port ${PORT}`)
  console.log(`This server handles API requests from ${FRONTEND_URL}`)
})

// Cleanup job to prevent memory leaks (runs every hour)
setInterval(
  () => {
    const now = Date.now()
    const staleThreshold = 2 * 60 * 60 * 1000 // 2 hours

    let removedCount = 0
    for (const [key, transaction] of pendingTransactions.entries()) {
      if (now - transaction.timestamp > staleThreshold) {
        pendingTransactions.delete(key)
        removedCount++
      }
    }

    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} stale pending transactions`)
    }
  },
  60 * 60 * 1000,
)

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`)
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY))
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY))
})

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
})

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason)
})

// Periodic cleanup of stale pending transactions (every 15 minutes)
setInterval(
  () => {
    const now = Date.now()
    const staleThreshold = 2 * 60 * 60 * 1000 // 2 hours

    let staleCount = 0
    for (const [id, txn] of pendingTransactions.entries()) {
      if (now - txn.timestamp > staleThreshold) {
        pendingTransactions.delete(id)
        staleCount++
      }
    }

    if (staleCount > 0) {
      console.log(`Cleaned up ${staleCount} stale pending transactions`)
    }
  },
  15 * 60 * 1000,
)

export default app

