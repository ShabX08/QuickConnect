import express from "express"
import fetch from "node-fetch"
import cors from "cors"
import { fileURLToPath } from "url"
import { dirname } from "path"
import dotenv from "dotenv"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const port = process.env.PORT || 3000

app.use(express.static("public"))
app.use(express.json())
app.use(cors())

// Initiate payment route
app.post("/api/initiate-payment", async (req, res) => {
  const { network, phone, volume, amount, email } = req.body
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY

  if (!paystackSecretKey) {
    console.error("Paystack secret key is not configured")
    return res.status(500).json({ error: "Paystack secret key is not configured" })
  }

  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${paystackSecretKey}`,
      },
      body: JSON.stringify({
        amount: amount * 100,
        email,
        metadata: {
          network,
          phone,
          volume,
        },
      }),
    })

    const data = await response.json()
    console.log("Received response from Paystack API:", data)

    if (data.status) {
      res.json({
        status: "success",
        data: {
          authorization_url: data.data.authorization_url,
          reference: data.data.reference,
        },
      })
    } else {
      res.status(400).json({ error: data.message })
    }
  } catch (error) {
    console.error("Error in Paystack API request:", error)
    res.status(500).json({ error: "An error occurred while processing your request." })
  }
})

// Verify payment and initiate Hubnet transaction
app.post("/api/verify-payment", async (req, res) => {
  const { reference } = req.body
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY
  const hubnetApiKey = process.env.HUBNET_API_KEY

  if (!paystackSecretKey || !hubnetApiKey) {
    console.error("Missing API keys (Paystack or Hubnet)")
    return res.status(500).json({ error: "API keys are not configured" })
  }

  try {
    // Verify payment with Paystack API
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
    })

    const verifyData = await verifyResponse.json()
    console.log("Paystack payment verification response:", verifyData)

    if (verifyData.status && verifyData.data.status === "success") {
      // Payment is successful, now initiate Hubnet transaction
      const { network, phone, volume } = verifyData.data.metadata

      // Initiate Hubnet transaction
      const hubnetResponse = await fetch(
        `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: `Bearer ${hubnetApiKey}`,
          },
          body: JSON.stringify({
            phone,
            volume,
            reference,
            referrer: process.env.CALLBACK_URL,
          }),
        },
      )

      const hubnetData = await hubnetResponse.json()
      console.log("Received response from Hubnet API:", hubnetData)

      if (hubnetData.status) {
        res.json({ status: "success", message: "Payment verified and data bundle initiated successfully" })
      } else {
        console.error("Hubnet transaction initiation failed:", hubnetData)
        res
          .status(400)
          .json({ status: "failed", message: "Hubnet transaction initiation failed", error: hubnetData.reason })
      }
    } else {
      console.error("Paystack payment verification failed:", verifyData)
      res.status(400).json({ status: "failed", message: "Payment verification failed", error: verifyData.message })
    }
  } catch (error) {
    console.error("Error in payment verification:", error)
    res.status(500).json({ error: "An error occurred while verifying the payment." })
  }
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
  console.log("Paystack Secret Key configured:", !!process.env.PAYSTACK_SECRET_KEY)
  console.log("Hubnet API Key configured:", !!process.env.HUBNET_API_KEY)
})

console.log("Paystack Secret Key configured:", !!process.env.PAYSTACK_SECRET_KEY)
console.log("Hubnet API Key configured:", !!process.env.HUBNET_API_KEY)
console.log("Callback URL configured:", process.env.CALLBACK_URL)

