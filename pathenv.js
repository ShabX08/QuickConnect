// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getDatabase, ref, set, push, get, query, orderByChild, equalTo, update } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

// Your web app's Firebase configuration
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
const mainContent = document.getElementById('main-content');
const loginPage = document.getElementById('login-page');
const signupPage = document.getElementById('signup-page');
const resetPage = document.getElementById('reset-page');
const profilePage = document.getElementById('profile-page');
const ordersPage = document.getElementById('orders-page');
const agentPage = document.getElementById('agent-page');
const loader = document.getElementById('loader');
const orderReceipt = document.getElementById('order-receipt');

// Network prices and volumes
const networkData = {
    mtn: {
        prices: {
            '1GB': 5.50,
            '2GB': 12,
            '5GB': 27,
            '10GB': 27
        },
        volumes: ['1GB', '2GB', '5GB', '10GB']
    },
    at: {
        prices: {
            '1GB': 5, '2GB': 9, '3GB': 13, '4GB': 18, '5GB': 20,
            '6GB': 23, '7GB': 27, '8GB': 35, '9GB': 36, '10GB': 42,
            '15GB': 61.5, '20GB': 80, '50GB': 140, '100GB': 250,
        },
        volumes: ['1GB', '2GB', '3GB', '4GB', '5GB', '6GB', '7GB', '8GB', '9GB', '10GB', '15GB', '20GB', '50GB', '100GB']
    }
};

// Helper function to hide all pages
function hideAllPages() {
    mainContent.classList.add('hidden');
    loginPage.classList.add('hidden');
    signupPage.classList.add('hidden');
    resetPage.classList.add('hidden');
    profilePage.classList.add('hidden');
    ordersPage.classList.add('hidden');
    agentPage.classList.add('hidden');
}

// Helper function to set active nav item
function setActiveNavItem(id) {
    document.querySelectorAll('.bottom-0 a').forEach(el => el.classList.remove('active-nav'));
    document.getElementById(id).classList.add('active-nav');
}

// Authentication state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        hideAllPages();
        mainContent.classList.remove('hidden');
        if (!localStorage.getItem('loggedInBefore')) {
            notyf.success('Logged in successfully!');
            localStorage.setItem('loggedInBefore', 'true');
        }
        loadUserProfile(user);
        loadUserOrders(user);
        hideAllSections();
        document.getElementById('home-section').classList.remove('hidden');
        loadHomePageData(user);
        setActiveNavItem('home-icon');
    } else {
        hideAllPages();
        loginPage.classList.remove('hidden');
    }
});

// Login
document.getElementById('login-button').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password)
        .then(() => {
            notyf.success('Logged in successfully!');
        })
        .catch(error => notyf.error(error.message));
});

// Sign Up
document.getElementById('signup-button').addEventListener('click', () => {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const phone = document.getElementById('signup-phone').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;

    if (password !== confirmPassword) {
        notyf.error('Passwords do not match, Check it well');
        return;
    }

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Save additional user info to the database
            const user = userCredential.user;
            return set(ref(database, 'users/' + user.uid), {
                name: name,
                email: email,
                phone: phone,
                editCount: 3
            });
        })
        .then(() => {
            notyf.success('Account created successfully!');
        })
        .catch(error => notyf.error(error.message));
});

// Reset Password
document.getElementById('reset-button').addEventListener('click', () => {
    const email = document.getElementById('reset-email').value;
    sendPasswordResetEmail(auth, email)
        .then(() => {
            notyf.success('Password reset email sent');
        })
        .catch(error => notyf.error(error.message));
});

// Navigation
document.getElementById('go-to-signup').addEventListener('click', () => {
    hideAllPages();
    signupPage.classList.remove('hidden');
});

document.getElementById('go-to-login').addEventListener('click', () => {
    hideAllPages();
    loginPage.classList.remove('hidden');
});

document.getElementById('go-to-reset').addEventListener('click', () => {
    hideAllPages();
    resetPage.classList.remove('hidden');
});

document.getElementById('go-to-login-from-reset').addEventListener('click', () => {
    hideAllPages();
    loginPage.classList.remove('hidden');
});

// Logout
document.getElementById('logout').addEventListener('click', () => {
    signOut(auth)
        .then(() => {
            notyf.success('Logged out successfully!');
            localStorage.removeItem('loggedInBefore');
        })
        .catch(error => notyf.error(error.message));
});

// Bottom navbar functionality
document.getElementById('home-icon').addEventListener('click', () => {
    if (auth.currentUser) {
        hideAllPages();
        mainContent.classList.remove('hidden');
        hideAllSections();
        document.getElementById('home-section').classList.remove('hidden');
        loadHomePageData(auth.currentUser);
        setActiveNavItem('home-icon');
    } else {
        notyf.error('Please log in to access this section');
    }
});

document.getElementById('data-icon').addEventListener('click', () => {
    if (auth.currentUser) {
        hideAllPages();
        mainContent.classList.remove('hidden');
        hideAllSections();
        document.getElementById('bundle-purchase-section').classList.remove('hidden');
        setActiveNavItem('data-icon');
    } else {
        notyf.error('Please log in to access this section');
    }
});

document.getElementById('profile-icon').addEventListener('click', () => {
    if (auth.currentUser) {
        hideAllPages();
        profilePage.classList.remove('hidden');
        loadUserProfile(auth.currentUser);
        setActiveNavItem('profile-icon');
    } else {
        notyf.error('Please log in to access this section');
    }
});

document.getElementById('orders-icon').addEventListener('click', () => {
    if (auth.currentUser) {
        hideAllPages();
        ordersPage.classList.remove('hidden');
        loadUserOrders(auth.currentUser);
        setActiveNavItem('orders-icon');
    } else {
        notyf.error('Please log in to access this section');
    }
});

document.getElementById('agent-icon').addEventListener('click', () => {
    if (auth.currentUser) {
        hideAllPages();
        agentPage.classList.remove('hidden');
        setActiveNavItem('agent-icon');
    } else {
        notyf.error('Please log in to access this section');
    }
});

// Purchase button
document.getElementById('purchase-button').addEventListener('click', () => {
    hideAllPages();
    mainContent.classList.remove('hidden');
    hideAllSections();
    document.getElementById('bundle-purchase-section').classList.remove('hidden');
    setActiveNavItem('data-icon');
});

// Add this new function to hide all sections
function hideAllSections() {
    document.getElementById('home-section').classList.add('hidden');
    document.getElementById('bundle-purchase-section').classList.add('hidden');
    orderReceipt.classList.add('hidden');
}

// Network selection change handler
document.getElementById('network').addEventListener('change', updateBundleOptions);

// Update bundle options based on selected network
function updateBundleOptions() {
    const network = document.getElementById('network').value;
    const bundleVolumeContainer = document.getElementById('bundle-volume-container');
    
    // Clear previous content
    bundleVolumeContainer.innerHTML = '';

    if (network) {
        // Create new select element
        const bundleVolumeSelect = document.createElement('select');
        bundleVolumeSelect.id = 'bundle-volume';
        bundleVolumeSelect.className = 'w-full p-2 bg-gray-700 text-gray-300 rounded text-sm';
        bundleVolumeSelect.innerHTML = '<option value="">Select package</option>';

        networkData[network].volumes.forEach(volume => {
            const option = document.createElement('option');
            option.value = volume;
            option.textContent = `${volume} - GHS ${networkData[network].prices[volume].toFixed(2)}`;
            bundleVolumeSelect.appendChild(option);
        });

        // Create label for the new select
        const label = document.createElement('label');
        label.htmlFor = 'bundle-volume';
        label.className = 'block text-gray-400 mb-1 sm:mb-2';
        label.innerHTML = '<span class="material-icons mr-1 align-middle text-sm">data_usage</span>BUNDLE VOLUME';

        // Append the new elements
        bundleVolumeContainer.appendChild(label);
        bundleVolumeContainer.appendChild(bundleVolumeSelect);

        // Add event listener to update price
        bundleVolumeSelect.addEventListener('change', updatePrice);
    }

    updatePrice();
}

// Update price based on selected network and volume
function updatePrice() {
    const network = document.getElementById('network').value;
    const volumeSelect = document.getElementById('bundle-volume');
    const priceElement = document.getElementById('bundle-price');

    if (network && volumeSelect && volumeSelect.value) {
        const volume = volumeSelect.value;
        const price = networkData[network].prices[volume];
        priceElement.textContent = `Cost: GHS ${price.toFixed(2)}`;
    } else {
        priceElement.textContent = '';
    }
}

// Send Bundle
document.getElementById('send-bundle').addEventListener('click', () => {
    const network = document.getElementById('network').value;
    const phoneNumber = document.getElementById('phone-number').value;
    const bundleVolumeSelect = document.getElementById('bundle-volume');
    
    if (!bundleVolumeSelect || network === '' || bundleVolumeSelect.value === '' || phoneNumber === '') {
        notyf.error('Please select a network, enter phone number, and select a package');
        return;
    }

    const bundleVolume = bundleVolumeSelect.value;

    // Show loader
    loader.classList.remove('hidden');

    // Calculate price
    const bundlePrice = networkData[network].prices[bundleVolume];

    // Initialize Paystack payment
    const handler = PaystackPop.setup({
        key: 'pk_test_465904782c379e7b5eb53646745fec92442a3af4',
        email: auth.currentUser.email,
        amount: bundlePrice * 100, // Amount in pesewas
        currency: 'GHS',
        ref: '' + Math.floor((Math.random() * 1000000000) + 1),
        callback: function(response) {
            // Hide loader
            loader.classList.add('hidden');
            notyf.success('Payment successful. Transaction reference: ' + response.reference);

            // Call the API to send the bundle
            sendBundle(network, phoneNumber, bundleVolume, response.reference);
        },
        onClose: function() {
            // Hide loader
            loader.classList.add('hidden');
            notyf.warning('Transaction was not completed, window closed.');
        }
    });
    handler.openIframe();
});

// Function to send bundle via API
async function sendBundle(network, phone, volume, reference) {
    const apiUrl = `https://console.hubnet.app/live/api/context/business/transaction/${network}-new-transaction`;
    const apiKey = 'v61fayeo5LeSlVy1AgjHqgXFrYAgogDr2E7'; // Replace with your actual API key

    const payload = {
        phone: phone,
        volume: parseFloat(volume) * 1000, // Convert GB to MB
        reference: reference,
        referrer: auth.currentUser.phoneNumber || '',
        webhook: 'https://your-webhook-url.com' // Replace with your actual webhook URL
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
            notyf.success('Activation successfully!');
            saveOrderToDatabase(network, phone, volume, reference, data.transaction_id);
            displayOrderReceipt(network, phone, volume, reference, data.transaction_id);
        } else {
            notyf.error('Failed to send bundle: ' + data.message);
        }
    } catch (error) {
        notyf.error('Error sending bundle: ' + error.message);
    }
}

// Function to save order to database
function saveOrderToDatabase(network, phone, volume, reference, transactionId) {
    const orderData = {
        network: network,
        phoneNumber: phone,
        bundleVolume: volume,
        price: networkData[network].prices[volume],
        userId: auth.currentUser.uid,
        transactionReference: reference,
        transactionId: transactionId,
        timestamp: new Date().toISOString(),
        status: 'pending'
    };

    push(ref(database, 'orders'), orderData)
        .then(() => {
            notyf.success('Order successfully');
            loadUserOrders(auth.currentUser);
            loadHomePageData(auth.currentUser);
        })
        .catch(error => notyf.error('Error saving order: ' + error.message));
}

// Function to display order receipt
function displayOrderReceipt(network, phone, volume, reference, transactionId) {
    const receiptContent = document.getElementById('receipt-content');
    const price = networkData[network].prices[volume];
    
    receiptContent.innerHTML = `
        <p><strong>Network:</strong> ${network.toUpperCase()}</p>
        <p><strong>Phone Number:</strong> ${phone}</p>
        <p><strong>Bundle Volume:</strong> ${volume}</p>
        <p><strong>Price:</strong> GHS ${price.toFixed(2)}</p>
        <p><strong>Transaction Reference:</strong> ${reference}</p>
        <p><strong>Transaction ID:</strong> ${transactionId}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Status:</strong> Pending</p>
    `;

    hideAllSections();
    orderReceipt.classList.remove('hidden');
}

// Load user profile
function loadUserProfile(user) {
    const profileInfo = document.getElementById('profile-info');
    get(ref(database, 'users/' + user.uid))
        .then((snapshot) => {
            const userData = snapshot.val();
            if (userData) {
                profileInfo.innerHTML = `
                    <p class="mb-2"><span class="material-icons mr-1 align-middle text-sm">person</span><strong>Name:</strong> ${userData.name}</p>
                    <p class="mb-2"><span class="material-icons mr-1 align-middle text-sm">email</span><strong>Email:</strong> ${userData.email}</p>
                    <p class="mb-2"><span class="material-icons mr-1 align-middle text-sm">phone</span><strong>Phone:</strong> ${userData.phone}</p>
                `;
                document.getElementById('edit-name').value = userData.name;
                document.getElementById('edit-phone').value = userData.phone;
                document.getElementById('edit-count').textContent = `Edits remaining: ${userData.editCount || 0}`;
            } else {
                profileInfo.innerHTML = 'User data not found.';
            }
        })
        .catch(error => {
            profileInfo.innerHTML = 'Error loading profile: ' + error.message;
        });
}

// Save profile changes
document.getElementById('save-profile').addEventListener('click', () => {
    const user = auth.currentUser;
    if (user) {
        const newName = document.getElementById('edit-name').value;
        const newPhone = document.getElementById('edit-phone').value;

        get(ref(database, 'users/' + user.uid))
            .then((snapshot) => {
                const userData = snapshot.val();
                if (userData && userData.editCount > 0) {
                    update(ref(database, 'users/' + user.uid), {
                        name: newName,
                        phone: newPhone,
                        editCount: userData.editCount - 1
                    })
                        .then(() => {
                            notyf.success('Profile updated successfully');
                            loadUserProfile(user);
                        })
                        .catch(error => notyf.error('Error updating profile: ' + error.message));
                } else {
                    notyf.error('You have reached the maximum number of edits');
                }
            })
            .catch(error => notyf.error('Error fetching user data: ' + error.message));
    }
});

// Load user orders
function loadUserOrders(user) {
    const ordersList = document.getElementById('orders-list');
    ordersList.innerHTML = 'Loading orders...';

    get(query(ref(database, 'orders'), orderByChild('userId'), equalTo(user.uid)))
        .then((snapshot) => {
            if (snapshot.exists()) {
                let ordersHtml = '';
                snapshot.forEach((childSnapshot) => {
                    const order = childSnapshot.val();
                    if (order && order.network) {
                        ordersHtml += `
                            <div class="mb-3 p-3 bg-gray-700 rounded text-xs sm:text-sm">
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">network_cell</span><strong>Network:</strong> ${order.network.toUpperCase()}</p>
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">phone</span><strong>Phone:</strong> ${order.phoneNumber}</p>
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">wifi</span><strong>Bundle:</strong> ${order.bundleVolume}</p>
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">attach_money</span><strong>Price:</strong> GHS ${order.price.toFixed(2)}</p>
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">event</span><strong>Date:</strong> ${new Date(order.timestamp).toLocaleString()}</p>
                                <p class="mb-1"><span class="material-icons mr-1 align-middle text-xs">tag</span><strong>Ref:</strong> ${order.transactionReference}</p>
                                <p><span class="material-icons mr-1 align-middle text-xs">info</span><strong>Status:</strong> ${order.status || 'Pending'}</p>
                            </div>
                        `;
                    }
                });
                ordersList.innerHTML = ordersHtml || 'No orders found.';
            } else {
                ordersList.innerHTML = 'No orders found.';
            }
        })
        .catch((error) => {
            ordersList.innerHTML = 'Error loading orders: ' + error.message;
        });
}

// Load home page data
function loadHomePageData(user) {
    const userGreeting = document.getElementById('user-greeting');
    const totalSpent = document.getElementById('total-spent');
    const ordersMade = document.getElementById('orders-made');
    const dataActivated = document.getElementById('data-activated');
    const lastOrder = document.getElementById('last-order');

    get(ref(database, 'users/' + user.uid))
        .then((snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.name) {
                userGreeting.textContent = `Welcome, ${userData.name}!`;
            } else {
                userGreeting.textContent = 'Welcome!';
            }
        })
        .catch(error => {
            console.error('Error loading user data:', error);
            userGreeting.textContent = 'Welcome!';
        });

    get(query(ref(database, 'orders'), orderByChild('userId'), equalTo(user.uid)))
        .then((snapshot) => {
            if (snapshot.exists()) {
                let totalAmount = 0;
                let totalData = 0;
                let orderCount = 0;
                let lastOrderDate = null;

                snapshot.forEach((childSnapshot) => {
                    const order = childSnapshot.val();
                    if (order && order.price && order.bundleVolume && order.timestamp) {
                        totalAmount += order.price;
                        totalData += parseFloat(order.bundleVolume);
                        orderCount++;

                        const orderDate = new Date(order.timestamp);
                        if (!lastOrderDate || orderDate > lastOrderDate) {
                            lastOrderDate = orderDate;
                        }
                    }
                });

                totalSpent.textContent = `GHS ${totalAmount.toFixed(2)}`;
                ordersMade.textContent = orderCount;
                dataActivated.textContent = `${totalData.toFixed(2)}GB`;
                lastOrder.textContent = lastOrderDate ? lastOrderDate.toLocaleDateString() : 'N/A';
            } else {
                totalSpent.textContent = 'GHS 0.00';
                ordersMade.textContent = '0';
                dataActivated.textContent = '0GB';
                lastOrder.textContent = 'N/A';
            }
        })
        .catch((error) => {
            console.error('Error loading orders:', error);
            totalSpent.textContent = 'Error';
            ordersMade.textContent = 'Error';
            dataActivated.textContent = 'Error';
            lastOrder.textContent = 'Error';
        });
}

// Send support message
document.getElementById('send-support-message').addEventListener('click', () => {
    const message = document.getElementById('support-message').value;
    if (message.trim() === '') {
        notyf.error('Please enter a message');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        notyf.error('You must be logged in to send a message');
        return;
    }

    // Get user data from the database
    get(ref(database, 'users/' + user.uid))
        .then((snapshot) => {
            const userData = snapshot.val();
            if (userData) {
                // Save the message to the database
                const supportMessage = {
                    userId: user.uid,
                    name: userData.name,
                    email: userData.email,
                    phone: userData.phone,
                    message: message,
                    timestamp: new Date().toISOString()
                };

                push(ref(database, 'support_messages'), supportMessage)
                    .then(() => {
                        notyf.success('Message sent to support team');
                        document.getElementById('support-message').value = '';
                    })
                    .catch((error) => {
                        notyf.error('Error sending message: ' + error.message);
                    });
            } else {
                notyf.error('User data not found');
            }
        })
        .catch((error) => {
            notyf.error('Error fetching user data: ' + error.message);
        });
});