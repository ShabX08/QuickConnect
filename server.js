// server.js
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to serve static files and parse JSON
app.use(express.static("public"));
app.use(express.json());

// Initiate Payment route
app.post("/api/initiate-payment", async (req, res) => {
    const { network, phone, volume, amount, email } = req.body;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;

    // Validate required fields
    if (!network || !phone || !volume || !amount || !email) {
        return res.status(400).json({ error: "All fields are required." });
    }

    if (!paystackSecretKey || !paystackPublicKey) {
        console.error("Paystack keys are not configured");
        return res.status(500).json({ error: "Paystack keys are not configured" });
    }

    try {
        // Send the request to Paystack API to initialize the payment
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${paystackSecretKey}`
            },
            body: JSON.stringify({
                amount: amount * 100, // Convert to kobo (Paystack expects kobo)
                email, // Send user's email
                metadata: {
                    network,
                    phone,
                    volume
                },
                callback_url: `${req.protocol}://${req.get('host')}/api/verify-payment`
            })
        });

        const data = await response.json();
        console.log("Received response from Paystack API:", data);

        if (data.status) {
            return res.json({
                status: 'success',
                data: {
                    authorization_url: data.data.authorization_url,
                    reference: data.data.reference
                }
            });
        } else {
            return res.status(400).json({ error: data.message });
        }
    } catch (error) {
        console.error("Error in Paystack API request:", error);
        return res.status(500).json({ error: "An error occurred while processing your request." });
    }
});

// Verify Payment route
app.get("/api/verify-payment", async (req, res) => {
    const { reference } = req.query;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const hubnetApiKey = process.env.HUBNET_API_KEY;

    // Validate reference
    if (!reference) {
        return res.status(400).json({ error: "Payment reference is required." });
    }

    if (!paystackSecretKey) {
        console.error("Paystack secret key is not configured");
        return res.status(500).json({ error: "Paystack secret key is not configured" });
    }

    try {
        // Verify the payment with Paystack API
        const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                "Authorization": `Bearer ${paystackSecretKey}`
            }
        });

        const verifyData = await verifyResponse.json();
        console.log("Received response from Paystack verification:", verifyData);

        if (verifyData.status && verifyData.data.status === 'success') {
            // Payment successful, initiate the Hubnet transaction
            const { network, phone, volume } = verifyData.data.metadata;

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
                        referrer: req.get('origin'),
                        webhook: `${req.protocol}://${req.get('host')}/api/webhook`,
                    }),
                }
            );

            const hubnetData = await hubnetResponse.json();
            console.log("Received response from Hubnet API:", hubnetData);

            // Redirect user to success page
            return res.redirect('/payment-success.html');
        } else {
            // Payment failed, redirect user to failed page
            return res.redirect('/payment-failed.html');
        }
    } catch (error) {
        console.error("Error in payment verification:", error);
        return res.redirect('/payment-failed.html');
    }
});

// Webhook route for Hubnet (if needed)
app.post("/api/webhook", (req, res) => {
    const data = req.body;
    // Handle webhook logic (e.g., update order status in the database)
    console.log("Received webhook data from Hubnet:", data);
    res.status(200).send("Webhook received");
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log("Paystack Secret Key configured:", !!process.env.PAYSTACK_SECRET_KEY);
    console.log("Paystack Public Key configured:", !!process.env.PAYSTACK_PUBLIC_KEY);
    console.log("Hubnet API Key configured:", !!process.env.HUBNET_API_KEY);
});
