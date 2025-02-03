const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

app.post("/api/initiate-payment", async (req, res) => {
    const { network, phone, volume, amount } = req.body;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;

    if (!paystackSecretKey || !paystackPublicKey) {
        console.error("Paystack keys are not configured");
        return res.status(500).json({ error: "Paystack keys are not configured" });
    }

    try {
        // Initiate payment via Paystack API
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${paystackSecretKey}`
            },
            body: JSON.stringify({
                amount: amount * 100, // Amount is expected in kobo by Paystack (multiply by 100)
                email: "customer@email.com", // Ideally, collect this from the user
                metadata: {
                    network,
                    phone,
                    volume
                }
            })
        });

        const data = await response.json();
        console.log("Received response from Paystack API:", data);

        if (data.status) {
            res.json({
                data: {
                    publicKey: paystackPublicKey,
                    amount,
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

app.get("/api/verify-payment/:reference", async (req, res) => {
    const { reference } = req.params;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    const hubnetApiKey = process.env.HUBNET_API_KEY;

    if (!paystackSecretKey || !hubnetApiKey) {
        console.error("Missing API keys (Paystack or Hubnet)");
        return res.status(500).json({ error: "API keys are not configured" });
    }

    try {
        // Verify payment via Paystack API
        const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                "Authorization": `Bearer ${paystackSecretKey}`
            }
        });

        const verifyData = await verifyResponse.json();
        console.log("Paystack payment verification response:", verifyData);

        if (verifyData.status && verifyData.data.status === 'success') {
            // Payment successful, now initiate Hubnet transaction
            const { network, phone, volume } = verifyData.data.metadata;

            // Initiating Hubnet transaction
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
                        webhook: `${req.protocol}://${req.get('host')}/api/webhook`, // Webhook URL
                    }),
                }
            );

            const hubnetData = await hubnetResponse.json();
            console.log("Received response from Hubnet API:", hubnetData);

            if (hubnetData.status === 'success') {
                res.json({ status: 'success', message: 'Payment verified and data bundle initiated' });
            } else {
                console.error("Hubnet transaction failed:", hubnetData);
                res.status(400).json({ status: 'failed', message: 'Hubnet transaction initiation failed' });
            }
        } else {
            console.error("Payment verification failed:", verifyData);
            res.status(400).json({ status: 'failed', message: 'Payment verification failed' });
        }
    } catch (error) {
        console.error("Error in payment verification:", error);
        res.status(500).json({ error: "An error occurred while verifying the payment." });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log("Paystack Secret Key configured:", !!process.env.PAYSTACK_SECRET_KEY);
    console.log("Paystack Public Key configured:", !!process.env.PAYSTACK_PUBLIC_KEY);
    console.log("Hubnet API Key configured:", !!process.env.HUBNET_API_KEY);
});
