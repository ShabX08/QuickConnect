const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const cors = require('cors');
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());
app.use(cors()); // Enable CORS for all origins

app.post("/api/initiate-payment", async (req, res) => {
    const { network, phone, volume, amount } = req.body;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;

    if (!paystackSecretKey || !paystackPublicKey) {
        console.error("Paystack keys are not configured");
        return res.status(500).json({ error: "Paystack keys are not configured" });
    }

    try {
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${paystackSecretKey}`
            },
            body: JSON.stringify({
                amount: amount * 100, // Convert to kobo
                email: req.body.email, // Make sure to send the user's email from the client
                metadata: {
                    network,
                    phone,
                    volume
                },
                callback_url: `${process.env.CALLBACK_URL}/api/verify-payment` // Set this manually in production if necessary
            })
        });

        const data = await response.json();
        console.log("Received response from Paystack API:", data);

        if (data.status) {
            res.json({
                status: 'success',
                data: {
                    authorization_url: data.data.authorization_url,
                    reference: data.data.reference
                }
            });
        } else {
            res.status(400).json({ error: data.message });
        }
    } catch (error) {
        console.error("Error in Paystack API request:", error);
        res.status(500).json({ error: "An error occurred while processing your request." });
    }
});

app.get("/api/verify-payment", async (req, res) => {
    const { reference } = req.query;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const hubnetApiKey = process.env.HUBNET_API_KEY;

    if (!paystackSecretKey) {
        console.error("Paystack secret key is not configured");
        return res.status(500).json({ error: "Paystack secret key is not configured" });
    }

    try {
        const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                "Authorization": `Bearer ${paystackSecretKey}`
            }
        });

        const verifyData = await verifyResponse.json();

        if (verifyData.status && verifyData.data.status === 'success') {
            // Payment successful, now initiate the Hubnet transaction
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

            res.redirect('/payment-success.html');
        } else {
            res.redirect('/payment-failed.html');
        }
    } catch (error) {
        console.error("Error in payment verification:", error);
        res.redirect('/payment-failed.html');
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log("Paystack Secret Key configured:", !!process.env.PAYSTACK_SECRET_KEY);
    console.log("Paystack Public Key configured:", !!process.env.PAYSTACK_PUBLIC_KEY);
    console.log("Hubnet API Key configured:", !!process.env.HUBNET_API_KEY);
});
