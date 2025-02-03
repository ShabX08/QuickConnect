// server.js
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

app.post("/api/initiate-payment", async (req, res) => {
    const { network, phone, volume, amount, email } = req.body;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
        console.error("Paystack secret key is not configured");
        return res.status(500).json({ error: "Paystack secret key is not configured" });
    }

    try {
        const amountInKobo = Math.round(parseFloat(amount) * 100);
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${paystackSecretKey}`
            },
            body: JSON.stringify({
                amount: amountInKobo,
                email: email,
                metadata: {
                    network,
                    phone,
                    volume
                },
                callback_url: `${req.protocol}://${req.get('host')}/payment-callback`
            })
        });

        const data = await response.json();

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

app.get("/payment-callback", (req, res) => {
    const { reference } = req.query;
    res.redirect(`/?reference=${reference}`);
});

app.post("/api/verify-payment", async (req, res) => {
    const { reference } = req.body;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const hubnetApiKey = process.env.HUBNET_API_KEY;

    if (!paystackSecretKey || !hubnetApiKey) {
        console.error("Paystack secret key or Hubnet API key is not configured");
        return res.status(500).json({ error: "Server configuration error" });
    }

    try {
        const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                "Authorization": `Bearer ${paystackSecretKey}`
            }
        });

        const verifyData = await verifyResponse.json();

        if (verifyData.status && verifyData.data.status === 'success') {
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

            if (hubnetData.status === 'success') {
                res.json({ status: 'success', message: 'Payment successful and data bundle initiated.' });
            } else {
                res.status(400).json({ status: 'error', message: 'Data bundle initiation failed.' });
            }
        } else {
            res.status(400).json({ status: 'error', message: 'Payment verification failed.' });
        }
    } catch (error) {
        console.error("Error in payment verification:", error);
        res.status(500).json({ status: 'error', message: 'An error occurred during payment verification.' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
