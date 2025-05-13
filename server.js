import express from "express"
import fetch from "node-fetch"
import dotenv from "dotenv"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"
import fs from "fs"

// Load environment variables
dotenv.config()

// Set up directory paths for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize Express app
const app = express()
const port = process.env.PORT || 3000

// Determine URLs based on environment
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${port}`
const BASE_URL = process.env.BASE_URL || `http://localhost:${port}`

// Middleware setup
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, "public")
if (!fs.existsSync(publicDir)) {
  try {
    fs.mkdirSync(publicDir, { recursive: true })
    console.log("Created public directory successfully")
  } catch (err) {
    console.error("Error creating public directory:", err)
    // Continue execution even if directory creation fails
  }
}

// Serve static files from the public directory
app.use(express.static(publicDir))

// Required API keys with fallbacks for testing
const HUBNET_API_KEY = process.env.HUBNET_API_KEY || ""
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || ""

// Validate required environment variables
if (!HUBNET_API_KEY || !PAYSTACK_SECRET_KEY) {
  console.warn("Missing required environment variables. Some features may not work correctly.")
  console.warn("HUBNET_API_KEY:", Boolean(HUBNET_API_KEY))
  console.warn("PAYSTACK_SECRET_KEY:", Boolean(PAYSTACK_SECRET_KEY))
}

// Create a persistent store for processed references
class TransactionStore {
  constructor() {
    this._store = new Map()
    this._filePath = path.join(__dirname, "processed_transactions.json")
    this.init()
  }

  init() {
    try {
      if (fs.existsSync(this._filePath)) {
        const data = JSON.parse(fs.readFileSync(this._filePath, "utf8"))
        // Convert the loaded array back to a Map
        this._store = new Map(Object.entries(data))
        console.log(`Loaded ${this._store.size} processed transactions from disk`)
      }
    } catch (error) {
      console.error("Error loading transaction store:", error)
      // Continue with empty store if file can't be loaded
    }
    return this
  }

  save() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this._filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      // Convert Map to object for JSON serialization
      const data = Object.fromEntries(this._store)
      fs.writeFileSync(this._filePath, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error("Error saving transaction store:", error)
      // Continue execution even if save fails
    }
  }

  has(reference) {
    return this._store.has(reference)
  }

  add(reference, metadata = {}) {
    this._store.set(reference, {
      timestamp: Date.now(),
      ...metadata,
    })

    // Save to disk after each addition for durability
    this.save()
    return this
  }

  get(reference) {
    return this._store.get(reference)
  }

  getAll() {
    return Array.from(this._store.entries()).map(([reference, metadata]) => ({
      reference,
      ...metadata,
    }))
  }

  cleanup(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    // Default: 30 days
    const now = Date.now()
    let count = 0

    for (const [reference, metadata] of this._store.entries()) {
      if (now - metadata.timestamp > maxAgeMs) {
        this._store.delete(reference)
        count++
      }
    }

    if (count > 0) {
      console.log(`Cleaned up ${count} old transaction records`)
      this.save()
    }

    return count
  }
}

// Initialize the transaction store
let processedTransactions
try {
  processedTransactions = new TransactionStore()
} catch (error) {
  console.error("Error initializing transaction store:", error)
  // Fallback to in-memory only store if file operations fail
  processedTransactions = {
    _store: new Map(),
    has: function(reference) { return this._store.has(reference) },
    add: function(reference, metadata = {}) { 
      this._store.set(reference, { timestamp: Date.now(), ...metadata })
      return this
    },
    get: function(reference) { return this._store.get(reference) },
    getAll: function() { 
      return Array.from(this._store.entries()).map(([reference, metadata]) => ({
        reference,
        ...metadata,
      }))
    },
    cleanup: function() { return 0 }
  }
}

/**
 * Generate a unique transaction reference
 * @param {string} prefix - Prefix for the reference (e.g., MTN_DATA, AT_DATA)
 * @returns {string} Unique reference ID
 */
function generateReference(prefix = "DATA") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
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

    // Handle non-JSON responses
    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      const textResponse = await response.text()
      console.error("Paystack returned non-JSON response:", textResponse)
      throw new Error(`Paystack returned non-JSON response. Status: ${response.status}`)
    }

    const data = await response.json()

    if (!response.ok) {
      console.error("Paystack error response:", data)
      throw new Error(`Paystack error: ${data.message || response.statusText}`)
    }

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

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Cache-Control": "no-cache",
      },
    })

    // Handle non-JSON responses
    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      const textResponse = await response.text()
      console.error("Paystack verification returned non-JSON response:", textResponse)
      throw new Error(`Paystack verification returned non-JSON response. Status: ${response.status}`)
    }

    const data = await response.json()

    if (!response.ok) {
      console.error("Paystack verification error:", data)
      throw new Error(`Paystack verification error: ${data.message || response.statusText}`)
    }

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

    // Log the raw response for debugging
    console.log(`Hubnet balance check response status: ${response.status}`)
    
    // Get the response as text first
    const responseText = await response.text()
    console.log(`Hubnet balance check raw response:`, responseText)

    // Try to parse the response as JSON
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      console.error("Error parsing Hubnet balance response:", e)
      throw new Error(`Hubnet balance check returned invalid JSON. Status code: ${response.status}, Response: ${responseText}`)
    }

    if (!response.ok) {
      console.error("Hubnet balance check error response:", data)
      const errorMessage = data.message || data.reason || response.statusText
      throw new Error(`Hubnet balance check error: ${errorMessage}. Status code: ${response.status}`)
    }

    return data
  } catch (error) {
    console.error("Error checking Hubnet balance:", error)
    throw error
  }
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
    if (processedTransactions.has(payload.reference)) {
      console.log(`Reference ${payload.reference} has already been processed, skipping Hubnet transaction`)
      const metadata = processedTransactions.get(payload.reference)

      // Return the cached response if available
      if (metadata && metadata.hubnetResponse) {
        console.log(`Returning cached Hubnet response for ${payload.reference}`)
        return metadata.hubnetResponse
      }

      // Otherwise return a generic success response
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

    // First check Hubnet balance to avoid failed transactions
    try {
      const balanceData = await checkHubnetBalance()
      if (!balanceData.status || balanceData.balance < 5) {
        console.log("Hubnet balance is insufficient:", balanceData)
        throw new Error("INSUFFICIENT_HUBNET_BALANCE")
      }
    } catch (balanceError) {
      console.error("Error checking Hubnet balance:", balanceError)
      if (balanceError.message === "INSUFFICIENT_HUBNET_BALANCE") {
        throw balanceError
      }
      // If it's just a balance check error, continue with the transaction attempt
    }

    console.log(`Processing Hubnet transaction for ${network} with payload:`, JSON.stringify(payload))

    // Using the correct endpoint from the documentation
    const apiUrl = `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`
    console.log(`Sending request to: ${apiUrl}`)

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        token: `Bearer ${HUBNET_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    // Log the raw response for debugging
    console.log(`Hubnet API response status: ${response.status}`)
    
    // Get the response as text first
    const responseText = await response.text()
    console.log(`Hubnet API raw response:`, responseText)

    // Try to parse the response as JSON
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      console.error("Error parsing Hubnet response:", e)
      throw new Error(`Hubnet API returned invalid JSON. Status code: ${response.status}, Response: ${responseText}`)
    }

    // Check for insufficient balance error
    if (
      data.event === "charge.rejected" &&
      data.status === "failed" &&
      data.message &&
      data.message.includes("insufficient")
    ) {
      console.error("Hubnet account has insufficient balance:", data)
      throw new Error("INSUFFICIENT_HUBNET_BALANCE")
    }

    // Check for other errors
    if (!response.ok || data.status === "failed") {
      console.error("Hubnet API error response:", data)
      const errorMessage = data.message || data.reason || response.statusText
      throw new Error(`Hubnet API error: ${errorMessage}. Status code: ${response.status}`)
    }

    console.log("Hubnet transaction result:", data)

    // Mark this reference as processed with the response data for future reference
    processedTransactions.add(payload.reference, {
      network,
      phone: payload.phone,
      volume: payload.volume,
      hubnetResponse: data,
      processedAt: new Date().toISOString(),
    })

    return data
  } catch (error) {
    console.error("Error processing Hubnet transaction:", error)

    // Important: We don't mark the transaction as processed if there was an error
    // This allows for retry attempts
    throw error
  }
}

// Home route
app.get("/", (req, res) => {
  res.send("Hubnet API Server is running")
})

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      PORT: port,
      FRONTEND_URL: FRONTEND_URL,
      BASE_URL: BASE_URL,
      HUBNET_API_KEY: Boolean(HUBNET_API_KEY),
      PAYSTACK_SECRET_KEY: Boolean(PAYSTACK_SECRET_KEY)
    }
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
 * Starts the payment process with Paystack for data bundle purchase or wallet deposit
 */
app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email, fcmToken, paymentType, reference } = req.body

  // Validate required fields based on payment type
  if (paymentType === "wallet") {
    // For wallet deposits, we only need amount and email
    if (!amount || !email) {
      return res.status(400).json({
        status: "error",
        message: "Missing required payment data. Please provide amount and email.",
      })
    }
  } else {
    // For data bundle purchases, we need network, phone, volume, amount, and email
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
  }

  try {
    // Generate a unique reference for this transaction or use provided one
    let transactionReference = reference;
    if (!transactionReference) {
      let prefix = "PAYMENT"
      if (paymentType === "wallet") {
        prefix = "WALLET_DEPOSIT"
      } else {
        prefix = network === "mtn" ? "MTN_DATA" : network === "at" ? "AT_DATA" : "BT_DATA"
      }
      transactionReference = generateReference(prefix)
    }

    // Convert amount to kobo (Paystack uses the smallest currency unit)
    const amountInKobo = Math.round(amount * 100)

    // Prepare Paystack payload
    const payload = {
      amount: amountInKobo,
      email,
      reference: transactionReference,
      callback_url: `${FRONTEND_URL}`,
      metadata: {
        paymentType: paymentType || "bundle",
        fcmToken: fcmToken || null,
        custom_fields: [
          {
            display_name: paymentType === "wallet" ? "Wallet Deposit" : "Data Bundle",
            variable_name: paymentType === "wallet" ? "wallet_deposit" : "data_bundle",
            value:
              paymentType === "wallet"
                ? `₵${amount} Wallet Deposit`
                : `${volume}MB for ${phone} (${network?.toUpperCase() || 'Unknown'})`,
          },
        ],
      },
    }

    // Add network, phone, and volume to metadata if this is a data bundle purchase
    if (paymentType !== "wallet") {
      payload.metadata.network = network
      payload.metadata.phone = phone
      payload.metadata.volume = volume
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
 * Process wallet purchase endpoint
 * Processes a data bundle purchase using wallet balance
 */
app.post("/api/process-wallet-purchase", async (req, res) => {
  const { userId, network, phone, volume, amount, email, fcmToken } = req.body

  // Validate required fields
  if (!userId || !network || !phone || !volume || !amount || !email) {
    return res.status(400).json({
      status: "error",
      message: "Missing required data. Please provide userId, network, phone, volume, amount, and email.",
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
    const prefix = network === "mtn" ? "MTN_WALLET" : network === "at" ? "AT_WALLET" : "BT_WALLET"
    const reference = generateReference(prefix)

    // Prepare Hubnet payload
    const hubnetPayload = {
      phone,
      volume: volume.toString(), // Ensure volume is a string as required by API
      reference,
      referrer: phone, // Using customer's phone as referrer to receive completion alerts
    }

    try {
      // Process data bundle with Hubnet
      const hubnetData = await processHubnetTransaction(hubnetPayload, network)

      // Return success response
      return res.json({
        status: "success",
        message: "Transaction completed successfully. Your data bundle has been processed.",
        data: {
          reference: reference,
          amount: Number.parseFloat(amount),
          phone: phone,
          volume: volume,
          network: network,
          timestamp: Date.now(),
          transaction_id: hubnetData.transaction_id || hubnetData.data?.transaction_id || "N/A",
          hubnetResponse: hubnetData,
        },
      })
    } catch (hubnetError) {
      console.error("Hubnet transaction error:", hubnetError)

      // Check for specific error types
      if (hubnetError.message === "INSUFFICIENT_HUBNET_BALANCE") {
        return res.status(503).json({
          status: "error",
          errorCode: "INSUFFICIENT_HUBNET_BALANCE",
          message: "Service provider has insufficient balance. Please try again later.",
        })
      }

      // Handle other errors
      return res.status(500).json({
        status: "error",
        message: "Failed to process data bundle. Please try again or contact support.",
        error: hubnetError.message,
      })
    }
  } catch (error) {
    console.error("Error in /api/process-wallet-purchase:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to process purchase. Please try again or contact support.",
      error: error.message,
    })
  }
})

/**
 * Verify payment and process data bundle
 * Implements a reliable transaction pattern to ensure exactly-once delivery
 */
app.get("/api/verify-payment/:reference", async (req, res) => {
  const { reference } = req.params

  if (!reference) {
    return res.status(400).json({
      status: "error",
      message: "Missing payment reference.",
    })
  }

  // Check if this reference has already been processed
  if (processedTransactions.has(reference)) {
    console.log(`Reference ${reference} has already been verified and processed`)
    const metadata = processedTransactions.get(reference)

    // Return the cached result
    return res.json({
      status: "success",
      message: "Transaction was already processed successfully.",
      data: {
        reference: reference,
        alreadyProcessed: true,
        processedAt: metadata.processedAt || new Date().toISOString(),
        hubnetResponse: metadata.hubnetResponse || null,
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
      // Check if this is a wallet deposit
      const paymentType = verifyData.data.metadata?.paymentType || "bundle"

      if (paymentType === "wallet") {
        // This is a wallet deposit, no need to process with Hubnet
        // Mark as processed to prevent duplicate processing
        processedTransactions.add(reference, {
          paymentType: "wallet",
          amount: verifyData.data.amount / 100,
          processedAt: new Date().toISOString(),
        })
        
        return res.json({
          status: "success",
          message: "Wallet deposit completed successfully.",
          data: {
            reference: verifyData.data.reference,
            amount: verifyData.data.amount / 100,
            paymentType: "wallet",
            timestamp: new Date(verifyData.data.paid_at).getTime(),
          },
        })
      }

      // This is a data bundle purchase
      // Extract metadata from verified payment
      const { phone, volume, network } = verifyData.data.metadata || {}
      
      // Validate required metadata
      if (!phone || !volume || !network) {
        console.error("Missing required metadata in payment:", verifyData.data)
        return res.status(400).json({
          status: "error",
          message: "Payment verification successful but missing required metadata for data bundle processing.",
        })
      }

      // Prepare Hubnet payload according to documentation
      const hubnetPayload = {
        phone,
        volume: volume.toString(), // Ensure volume is a string as required by API
        reference,
        referrer: phone, // Using customer's phone as referrer to receive completion alerts
      }

      try {
        // Process data bundle with Hubnet
        // This function now handles duplicate prevention internally
        const hubnetData = await processHubnetTransaction(hubnetPayload, network)

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
        console.error("Error processing Hubnet transaction:", hubnetError)

        // Important: We don't mark the transaction as processed if there was an error
        // This allows for retry attempts

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
    } else {
      return res.json({
        status: "failed",
        paymentStatus: "failed",
        message: "Payment failed or was cancelled.",
        data: verifyData.data,
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
 * Endpoint to manually retry a failed data bundle transaction
 * This can be used by admin or support to resolve issues
 */
app.post("/api/retry-transaction/:reference", async (req, res) => {
  const { reference } = req.params
  const { network, phone, volume } = req.body

  if (!reference || !network || !phone || !volume) {
    return res.status(400).json({
      status: "error",
      message: "Missing required parameters. Please provide reference, network, phone, and volume.",
    })
  }

  try {
    // Verify the payment first to ensure it was successful
    const verifyData = await verifyPaystackPayment(reference)

    if (!verifyData.status || verifyData.data.status !== "success") {
      return res.status(400).json({
        status: "error",
        message: "Cannot retry transaction. Original payment was not successful.",
      })
    }

    // Prepare Hubnet payload
    const hubnetPayload = {
      phone,
      volume: volume.toString(),
      reference,
      referrer: phone,
    }

    // Force retry by temporarily removing from processed transactions if it exists
    let existingData = null
    if (processedTransactions.has(reference)) {
      existingData = processedTransactions.get(reference)
      // We'll keep the record but mark it for retry
      processedTransactions.add(reference, {
        ...existingData,
        retryAttempted: true,
        retryTimestamp: Date.now(),
      })
    }

    // Process the data bundle
    const hubnetData = await processHubnetTransaction(hubnetPayload, network)

    return res.json({
      status: "success",
      message: "Transaction retry completed successfully.",
      data: {
        reference,
        phone,
        volume,
        network,
        timestamp: Date.now(),
        transaction_id: hubnetData.transaction_id || hubnetData.data?.transaction_id || "N/A",
        hubnetResponse: hubnetData,
        previousAttempt: existingData ? true : false,
      },
    })
  } catch (error) {
    console.error("Error retrying transaction:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to retry transaction. Please try again or contact support.",
      error: error.message,
    })
  }
})

/**
 * Endpoint to check transaction status
 * This can be used by clients to check if a transaction has been processed
 */
app.get("/api/transaction-status/:reference", async (req, res) => {
  const { reference } = req.params

  if (!reference) {
    return res.status(400).json({
      status: "error",
      message: "Missing transaction reference.",
    })
  }

  try {
    // Check if the transaction has been processed
    if (processedTransactions.has(reference)) {
      const metadata = processedTransactions.get(reference)

      return res.json({
        status: "success",
        message: "Transaction status retrieved successfully.",
        data: {
          reference,
          processed: true,
          processedAt: metadata.processedAt || new Date(metadata.timestamp).toISOString(),
          details: metadata,
        },
      })
    } else {
      // If not processed, check with Paystack to see if payment was successful
      try {
        const verifyData = await verifyPaystackPayment(reference)

        if (verifyData.status && verifyData.data.status === "success") {
          return res.json({
            status: "pending",
            message: "Payment successful but data bundle not yet processed.",
            data: {
              reference,
              processed: false,
              paymentStatus: "success",
              paymentDetails: {
                amount: verifyData.data.amount / 100,
                phone: verifyData.data.metadata?.phone,
                volume: verifyData.data.metadata?.volume,
                network: verifyData.data.metadata?.network,
                paidAt: verifyData.data.paid_at,
              },
            },
          })
        } else {
          return res.json({
            status: "pending",
            message: "Payment not successful or still pending.",
            data: {
              reference,
              processed: false,
              paymentStatus: verifyData.data.status,
            },
          })
        }
      } catch (paymentError) {
        console.error("Error verifying payment for transaction status:", paymentError)
        return res.json({
          status: "unknown",
          message: "Transaction reference not found or error checking payment status.",
          data: {
            reference,
            processed: false,
            error: paymentError.message,
          },
        })
      }
    }
  } catch (error) {
    console.error("Error checking transaction status:", error)
    return res.status(500).json({
      status: "error",
      message: "Failed to check transaction status. Please try again.",
      error: error.message,
    })
  }
})

/**
 * Fallback route for handling 404s
 */
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Endpoint not found",
  })
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

// Periodic cleanup of old transaction records (run once a day)
const cleanupInterval = setInterval(
  () => {
    try {
      const maxAgeMs = 90 * 24 * 60 * 60 * 1000 // 90 days
      const cleanedCount = processedTransactions.cleanup(maxAgeMs)
      console.log(`Scheduled cleanup: removed ${cleanedCount} transaction records older than 90 days`)
    } catch (error) {
      console.error("Error during scheduled cleanup:", error)
    }
  },
  24 * 60 * 60 * 1000
) // Run every 24 hours

// Ensure cleanup interval is cleared if the process exits
process.on('SIGTERM', () => {
  clearInterval(cleanupInterval)
  console.log('Cleanup interval cleared on SIGTERM')
  process.exit(0)
})

process.on('SIGINT', () => {
  clearInterval(cleanupInterval)
  console.log('Cleanup interval cleared on SIGINT')
  process.exit(0)
})

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at ${BASE_URL}`)
  console.log("🔑 Hubnet API Key configured:", Boolean(HUBNET_API_KEY))
  console.log("🔑 Paystack Secret Key configured:", Boolean(PAYSTACK_SECRET_KEY))
  console.log(`💾 Transaction store initialized with ${processedTransactions.getAll().length} records`)
})

// Export app for testing purposes
export default app
