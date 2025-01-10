// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAxdZufEUNjmHNrOtOH4GFtd2joqJzs_sk",
    authDomain: "gigs-hub-a0f14.firebaseapp.com",
    projectId: "gigs-hub-a0f14",
    storageBucket: "gigs-hub-a0f14.firebasestorage.app",
    messagingSenderId: "997297677705",
    appId: "1:997297677705:web:34d11ec60893183499ed58"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// Initialize Notyf
const notyf = new Notyf({
    duration: 3000,
    position: {x: 'right', y: 'top'},
});

// Elements
const activationSection = document.getElementById('activation-section');
const bundlePurchaseSection = document.getElementById('bundle-purchase-section');
const activateButton = document.getElementById('activate-button');
const loader = document.getElementById('loader');

// Bundle prices from the image
const bundlePrices = {
    mtn: {
        '1': 4.80,
        '2': 9.60,
        '3': 14.40,
        '4': 19.20,
        '5': 24.00,
        '6': 28.80,
        '7': 38.40,
        '10': 46.00,
        '15': 72.00,
        '20': 96.00,
        '30': 130.00,
        '50': 220.00
    },
    at: {
        '1': 4.50,
        '2': 9.00,
        '3': 13.50,
        '4': 18.00,
        '5': 22.50,
        '6': 27.00,
        '7': 36.00,
        '10': 43.00,
        '15': 67.50,
        '20': 90.00,
        '30': 122.00,
        '50': 205.00
    }
};

// Bundle volumes (in GB)
const bundleVolumes = Object.keys(bundlePrices.mtn);

// Authentication state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        checkAgentStatus(user);
    } else {
        notyf.error('Please log in to access the agent portal');
        window.location.href = 'index.html';
    }
});

// Check agent status
function checkAgentStatus(user) {
    get(ref(database, 'users/' + user.uid + '/agentPortalActive'))
        .then((snapshot) => {
            if (snapshot.exists() && snapshot.val() === true) {
                showBundlePurchaseSection();
            } else {
                showActivationSection();
            }
        })
        .catch((error) => {
            console.error('Error checking agent status:', error);
            notyf.error('Error checking agent status');
        });
}

// Show/hide sections
function showActivationSection() {
    activationSection.classList.remove('hidden');
    bundlePurchaseSection.classList.add('hidden');
}

function showBundlePurchaseSection() {
    activationSection.classList.add('hidden');
    bundlePurchaseSection.classList.remove('hidden');
}

// Activate agent portal
activateButton.addEventListener('click', () => {
    const user = auth.currentUser;
    if (user) {
        const handler = PaystackPop.setup({
            key: 'pk_test_465904782c379e7b5eb53646745fec92442a3af4',
            email: user.email,
            amount: 5000,
            currency: 'GHS',
            ref: '' + Math.floor((Math.random() * 1000000000) + 1),
            callback: function(response) {
                set(ref(database, 'users/' + user.uid + '/agentPortalActive'), true)
                    .then(() => {
                        notyf.success('Agent portal activated successfully!');
                        showBundlePurchaseSection();
                    })
                    .catch((error) => {
                        console.error('Error activating agent portal:', error);
                        notyf.error('Error activating agent portal');
                    });
            },
            onClose: function() {
                notyf.warning('Activation was not completed, window closed.');
            }
        });
        handler.openIframe();
    } else {
        notyf.error('Please log in to activate the agent portal');
    }
});

// Network selection handler
document.getElementById('network').addEventListener('change', updateBundleOptions);
document.getElementById('bundle-volume').addEventListener('change', updatePrice);

// Update bundle options
function updateBundleOptions() {
    const network = document.getElementById('network').value;
    const bundleVolumeSelect = document.getElementById('bundle-volume');
    bundleVolumeSelect.innerHTML = '<option value="">Select package</option>';

    if (network) {
        bundleVolumes.forEach(volume => {
            const option = document.createElement('option');
            option.value = volume;
            option.textContent = volume === '1' ? `${volume}GB` : 
                               parseInt(volume) >= 10 ? `${volume}GB` : 
                               `${volume}GB`;
            bundleVolumeSelect.appendChild(option);
        });
    }

    updatePrice();
}

// Update price display
function updatePrice() {
    const network = document.getElementById('network').value;
    const volume = document.getElementById('bundle-volume').value;
    const priceElement = document.getElementById('bundle-price');

    if (network && volume) {
        const price = bundlePrices[network][volume];
        priceElement.textContent = `PRICE: GHS ${price.toFixed(2)}`;
    } else {
        priceElement.textContent = '';
    }
}

// Send Bundle
document.getElementById('send-bundle').addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) {
        notyf.error('Please log in to send a bundle');
        return;
    }

    const network = document.getElementById('network').value;
    const phoneNumber = document.getElementById('phone-number').value;
    const bundleVolume = document.getElementById('bundle-volume').value;

    if (!network || !bundleVolume || !phoneNumber) {
        notyf.error('Please fill in all fields');
        return;
    }

    loader.classList.remove('hidden');

    const bundlePrice = bundlePrices[network][bundleVolume];

    const handler = PaystackPop.setup({
        key: 'pk_test_465904782c379e7b5eb53646745fec92442a3af4',
        email: user.email,
        amount: bundlePrice * 100,
        currency: 'GHS',
        ref: '' + Math.floor((Math.random() * 1000000000) + 1),
        callback: function(response) {
            loader.classList.add('hidden');
            notyf.success('Payment successful. Reference: ' + response.reference);
            sendBundle(network, phoneNumber, bundleVolume, response.reference);
        },
        onClose: function() {
            loader.classList.add('hidden');
            notyf.warning('Transaction was not completed, window closed.');
        }
    });
    handler.openIframe();
});

// Send bundle via API
async function sendBundle(network, phone, volume, reference) {
    const apiUrl = `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`;
    const apiKey = 'v61fayeo5LeSlVy1AgjHqgXFrYAgogDr2E7';

    const payload = {
        phone: phone,
        volume: parseInt(volume) * 1000,
        reference: reference,
        referrer: auth.currentUser.phoneNumber || '',
        webhook: 'https://your-webhook-url.com'
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'token': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status) {
            notyf.success('Bundle sent successfully!');
            saveOrderToDatabase(network, phone, volume, reference, data.transaction_id);
        } else {
            notyf.error('Failed to send bundle: ' + data.message);
        }
    } catch (error) {
        notyf.error('Error sending bundle: ' + error.message);
    }
}

// Save order to database
function saveOrderToDatabase(network, phone, volume, reference, transactionId) {
    const user = auth.currentUser;
    if (!user) {
        notyf.error('Error: User not logged in');
        return;
    }

    const orderData = {
        network: network,
        phoneNumber: phone,
        bundleVolume: volume + (parseInt(volume) >= 10 ? 'GIG' : 'GB'),
        price: bundlePrices[network][volume],
        userId: user.uid,
        transactionReference: reference,
        transactionId: transactionId,
        timestamp: new Date().toISOString(),
        isAgentOrder: true
    };

    set(ref(database, 'orders/' + transactionId), orderData)
        .then(() => {
            notyf.success('Order saved successfully');
        })
        .catch(error => {
            console.error('Error saving order:', error);
            notyf.error('Error saving order: ' + error.message);
        });
}