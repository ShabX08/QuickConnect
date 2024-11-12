document.addEventListener('DOMContentLoaded', () => {
    let cart = [];
    const cartButton = document.getElementById('cart-button');
    const cartSection = document.getElementById('cart');
    const cartItems = document.getElementById('cart-items');
    const cartCount = document.getElementById('cart-count');
    const checkoutForm = document.getElementById('checkout-form');
    const closeButton = document.getElementById('close-button');

    // Initialize Notyf for notifications
    const notyf = new Notyf({ position: { x: 'center', y: 'top' }, duration: 3500 });

    // Show cart on button click
    cartButton.addEventListener('click', () => {
        cartSection.style.display = 'block';
    });

    // Close cart section
    closeButton.addEventListener('click', () => {
        cartSection.style.display = 'none';
    });

    // Add item to cart
    document.querySelectorAll('.add-to-cart').forEach(button => {
        button.addEventListener('click', function() {
            const product = this.closest('.product-item');
            const id = product.getAttribute('data-id');
            const name = product.getAttribute('data-name');
            const price = parseFloat(product.getAttribute('data-price'));

            const existingProduct = cart.find(item => item.id === id);
            if (existingProduct) {
                existingProduct.quantity += 1;
            } else {
                cart.push({ id, name, price, quantity: 1 });
            }
            updateCart();
            notyf.success(`${name} has been added to cart!`);
        });
    });

    // Remove item from cart
    function removeItemFromCart(id) {
        cart = cart.filter(item => item.id !== id);
        updateCart();
    }

    // Deduct item quantity
    function deductItemQuantity(id) {
        const item = cart.find(item => item.id === id);
        if (item) {
            if (item.quantity > 1) {
                item.quantity -= 1;
            } else {
                removeItemFromCart(id);
            }
        }
        updateCart();
    }

    // Update cart display
    function updateCart() {
        cartItems.innerHTML = '';
        cart.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                ${item.name} x ${item.quantity} - GHS ${(item.price * item.quantity / 100).toFixed(2)}
                <button onclick="deductItemQuantity('${item.id}')">-</button>
                <button onclick="removeItemFromCart('${item.id}')">Remove</button>
            `;
            cartItems.appendChild(li);
        });
        cartCount.textContent = cart.length;
    }

    // Apply promo code
    function applyPromoCode(promoCode) {
        const validPromoCodes = {
            'WE ARE BACK': 70
        };
        return validPromoCodes[promoCode.toUpperCase()] || 0;
    }

    // Handle checkout form submission
    checkoutForm.addEventListener('submit', function(event) {
        event.preventDefault();

        const amount = cart.reduce((total, item) => total + item.price * item.quantity, 0);
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const promoCode = document.getElementById('Promo').value;

        const discountInPesewas = applyPromoCode(promoCode);
        const finalTotal = Math.max(amount - discountInPesewas, 0);

        if (discountInPesewas > 0) {
            notyf.success(`Discount Applied! You saved GHS ${(discountInPesewas / 100).toFixed(2)}`);
        } else {
            notyf.error('Invalid Promo Code. No discount applied.');
        }

        const botToken = '7508266654:AAEUIXI7J3WChv_YBT31KBRjaRUGv0gewE8'; // Replace with your Telegram bot token
        const chatId = '7513572473'; // Replace with your Telegram chat ID

        const handler = PaystackPop.setup({
            key: 'pk_live_0e70d8a9612b98c92761e3478abc47f900338df2', // Replace with your Paystack public key
            email: email,
            amount: finalTotal,
            currency: 'GHS',
            callback: function(response) {
                const paymentStatus = response.status; // Check payment status
                if (paymentStatus) {
                    notyf.success('Payment successful! Order is being processed.');

                    // Send order to Telegram
                    const message = `
🛒 *New Order Received* 🛒\n
👤 *Customer Name*: ${name}\n
📧 *Email*: ${email}\n
📱 *Phone*: ${phone}\n
💰 *Amount After Discount*: GHS ${(finalTotal / 100).toFixed(2)}\n
\n🛍️ *Products Ordered*:\n${cart.map(item => `• ${item.name} x ${item.quantity} - GHS ${(item.price * item.quantity / 100).toFixed(2)}`).join('\n')}
                    `;

                    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
                    })
                    .then(response => response.json())
                    .then(result => {
                        if (!result.ok) {
                            notyf.error('Error placing order.');
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        notyf.error('Error sending order to Telegram.');
                    });

                    cart = [];
                    updateCart();
                    cartSection.style.display = 'none';
                    checkoutForm.reset();
                } else {
                    notyf.error('Payment failed. Please try again.');
                }
            },
            onClose: function() {
                notyf.error('Payment window closed. You can try again later.');
            }
        });
        handler.openIframe();
    });

    window.removeItemFromCart = removeItemFromCart;
    window.deductItemQuantity = deductItemQuantity;
});

// Hide loader on window load
window.addEventListener("load", function() {
    const loader = document.getElementById('loader');
    loader.style.display = 'none';
});

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

// Service Worker for caching
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    return caches.delete(cacheName);
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

// Listen for updates
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});

const originalCode = `
    function greet() {
        console.log('Hello, World!');
    }
    greet();
`;

function minify(code) {
    return code.replace(/\s+/g, ' ').replace(/; /g, ';').trim();
}

eval(minify(originalCode));
