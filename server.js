document.addEventListener("DOMContentLoaded", () => {
  console.log("AirtelTigo page loaded")

  // Initialize global libraries
  const feather = window.feather
  const firebase = window.firebase
  const Swal = window.Swal

  // Initialize Feather icons
  if (typeof feather !== "undefined") {
    feather.replace()
  } else {
    console.warn("Feather icons not loaded. Make sure to include the feather-icons script in your HTML.")
  }

  // State variables
  let selectedQuantity = null
  let selectedPrice = null
  const selectedNetwork = "at" // Fixed to AirtelTigo only
  let isProcessingPayment = false
  let isVerifyingPayment = false

  // AirtelTigo bundles configuration
  const AT_BUNDLES = [
    { volume: 1000, price: 5.5 },
    { volume: 2000, price: 10.5 },
    { volume: 3000, price: 14.0 },
    { volume: 4000, price: 19.0 },
    { volume: 5000, price: 23.5 },
    { volume: 6000, price: 28.0 },
  ]

  // DOM Elements
  const menuToggle = document.getElementById("menu-toggle")
  const closeMenu = document.getElementById("close-menu")
  const mobileMenu = document.getElementById("mobile-menu")
  const sendBundleButton = document.getElementById("send-bundle")
  const logoutButton = document.getElementById("logoutButton")
  const spinner = document.getElementById("spinner")
  const ordersContainer = document.querySelector(".orders-container")
  const loginLink = document.getElementById("loginLink")
  const mobileLoginLink = document.getElementById("mobileLoginLink")
  const selectedQuantityElement = document.getElementById("selected-quantity")
  const bundleContainer = document.getElementById("bundle-container")

  // Event Listeners
  menuToggle?.addEventListener("click", toggleMenu)
  closeMenu?.addEventListener("click", toggleMenu)
  sendBundleButton?.addEventListener("click", sendDataBundle)
  logoutButton?.addEventListener("click", handleLogout)

  // Navigation event listeners
  document.querySelectorAll(".nav-link").forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      if (this.getAttribute("href").startsWith("#")) {
        e.preventDefault()
        const sectionId = this.getAttribute("href").substring(1)
        if (sectionId === "account" || sectionId === "orders" || sectionId === "data") {
          if (!firebase.auth().currentUser) {
            redirectToAuth()
            return
          }
        }
        showSection(sectionId)
        if (window.innerWidth < 768) {
          toggleMenu()
        }
      }
    })
  })

  // Show home section by default
  showSection("home")

  // Firebase Configuration
  const firebaseConfig = {
    apiKey: "AIzaSyDHlTB8g9c2i4KKBfK8Lz6w9vciXD_az9Q",
    authDomain: "quickconnect-db502.firebaseapp.com",
    projectId: "quickconnect-db502",
    storageBucket: "quickconnect-db502.firebasestorage.app",
    messagingSenderId: "7464982254",
    appId: "1:7464982254:web:2e7ae1ec804be108b685ff",
    measurementId: "G-YVNNR0LJ1Q",
    databaseURL: "https://quickconnect-db502-default-rtdb.firebaseio.com",
  }

  // Initialize Firebase
  try {
    firebase.initializeApp(firebaseConfig)
    console.log("Firebase initialized successfully")
  } catch (error) {
    console.error("Firebase initialization error:", error)
    showErrorAlert("Failed to initialize Firebase. Please refresh the page.")
  }

  // Firebase Cloud Messaging Implementation
  const FCM = {
    token: null,
    messaging: null,
    initialized: false,
    vapidKey: "BLCaJVR0q4qga6bHDMNu5_2Q5BFI2WcAGaRyXI8iCx2fumWcF7yITw4jzRq7855sjyda4BzZX_g8Vln7ZyKVowM",

    // Initialize FCM
    init: function () {
      try {
        if (typeof firebase.messaging === "undefined") {
          console.error("Firebase Messaging is not loaded. Add the firebase-messaging-compat.js script to your HTML.")
          return this
        }

        this.messaging = firebase.messaging()
        this.initialized = true
        this.setupMessageListener()
        this.registerServiceWorker()

        console.log("Firebase Cloud Messaging initialized successfully")

        if (Notification.permission === "granted") {
          this.getToken()
            .then((token) => {
              if (token) {
                console.log("FCM token retrieved automatically:", token)
                this.saveTokenToDatabase(token)
              }
            })
            .catch((error) => {
              console.error("Error getting token automatically:", error)
            })
        }

        return this
      } catch (error) {
        console.error("Error initializing Firebase Messaging:", error)
        return this
      }
    },

    // Register service worker
    registerServiceWorker: function () {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .register("/firebase-messaging-sw.js")
          .then((registration) => {
            console.log("Service Worker registered with scope:", registration.scope)
            this.messaging.useServiceWorker(registration)
          })
          .catch((error) => {
            console.error("Service Worker registration failed:", error)
          })
      } else {
        console.warn("Service Workers are not supported in this browser. Background notifications will not work.")
      }
    },

    // Request notification permission
    requestPermission: function () {
      return new Promise((resolve, reject) => {
        if (!this.initialized) {
          this.init()
        }

        Notification.requestPermission()
          .then((permission) => {
            if (permission === "granted") {
              console.log("Notification permission granted.")
              this.getToken()
                .then((token) => {
                  if (token) {
                    this.saveTokenToDatabase(token)
                  }
                  resolve(true)
                })
                .catch((error) => {
                  console.error("Error getting token after permission granted:", error)
                  reject(error)
                })
            } else {
              console.log("Notification permission denied.")
              resolve(false)
            }
          })
          .catch((error) => {
            console.error("Error requesting notification permission:", error)
            reject(error)
          })
      })
    },

    // Get FCM token
    getToken: function () {
      return new Promise((resolve, reject) => {
        if (!this.initialized) {
          this.init()
        }

        if (Notification.permission !== "granted") {
          this.requestPermission()
            .then((granted) => {
              if (granted) {
                this.getTokenInternal(resolve, reject)
              } else {
                resolve(null)
              }
            })
            .catch(reject)
        } else {
          this.getTokenInternal(resolve, reject)
        }
      })
    },

    // Internal method to get token
    getTokenInternal: function (resolve, reject) {
      this.messaging
        .getToken({ vapidKey: this.vapidKey })
        .then((currentToken) => {
          if (currentToken) {
            console.log("FCM token:", currentToken)
            this.token = currentToken
            resolve(currentToken)
          } else {
            console.log("No registration token available.")
            resolve(null)
          }
        })
        .catch((error) => {
          console.error("Error getting FCM token:", error)
          reject(error)
        })
    },

    // Set up message listener for foreground messages
    setupMessageListener: function () {
      if (!this.initialized) {
        this.init()
        return
      }

      this.messaging.onMessage((payload) => {
        console.log("Message received in foreground:", payload)

        // Show notification using SweetAlert2
        if (payload.notification) {
          Swal.fire({
            title: payload.notification.title || "New Notification",
            text: payload.notification.body || "",
            icon: "info",
            toast: true,
            position: "top-end",
            showConfirmButton: false,
            timer: 5000,
            timerProgressBar: true,
            didOpen: (toast) => {
              toast.addEventListener("mouseenter", Swal.stopTimer)
              toast.addEventListener("mouseleave", Swal.resumeTimer)
            },
          })
        }

        // Handle order status updates
        if (payload.data && payload.data.type === "order_update") {
          const user = firebase.auth().currentUser
          if (user) {
            loadUserOrders(user.uid)
          }
        }
      })
    },

    // Save token to Firebase database
    saveTokenToDatabase: (token) => {
      const user = firebase.auth().currentUser
      if (user) {
        const userTokensRef = firebase.database().ref("user_tokens/" + user.uid)
        userTokensRef.set({
          token: token,
          lastUpdated: firebase.database.ServerValue.TIMESTAMP,
        })

        // Also update the user's profile with the token
        const userRef = firebase.database().ref("users/" + user.uid)
        userRef.update({
          fcmToken: token,
        })

        console.log("Token saved to database for user:", user.uid)
      } else {
        console.log("User not logged in, token not saved to database")
      }
    },
  }

  // Initialize FCM
  FCM.init()

  // Auth state change listener
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      loadUserOrders(user.uid)
      loadUserAccount(user.uid)
      updateLoginLinks("Logout", "#", handleLogout)

      // Get FCM token when user logs in
      FCM.getToken().then((token) => {
        if (token) {
          FCM.saveTokenToDatabase(token)
        }
      })

      // Check for payment reference on page load
      const paymentReference = localStorage.getItem("paymentReference")
      if (paymentReference) {
        verifyPayment(paymentReference, user.uid)
      }
    } else {
      hideUserSections()
      updateLoginLinks("Login", "auth.html")
    }
  })

  // Helper Functions
  function toggleMenu() {
    mobileMenu?.classList.toggle("translate-x-0")
  }

  function showSection(sectionId) {
    document.querySelectorAll("main > section").forEach((section) => {
      section.classList.add("hidden")
    })
    const targetSection = document.getElementById(sectionId)
    if (targetSection) {
      targetSection.classList.remove("hidden")
    }

    document.querySelectorAll(".nav-link").forEach((link) => {
      if (link.getAttribute("href") === `#${sectionId}`) {
        link.classList.add("text-blue-600")
      } else {
        link.classList.remove("text-blue-600")
      }
    })
  }

  function hideUserSections() {
    document.getElementById("account")?.classList.add("hidden")
    document.getElementById("orders")?.classList.add("hidden")
    if (ordersContainer) {
      ordersContainer.innerHTML = "<p>Please log in to view your orders.</p>"
    }
  }

  function updateLoginLinks(text, href, clickHandler = null) {
    ;[loginLink, mobileLoginLink].forEach((link) => {
      if (link) {
        link.textContent = text
        link.href = href

        // Remove existing event listeners  {
        link.textContent = text
        link.href = href

        // Remove existing event listeners
        if (clickHandler === null) {
          link.removeEventListener("click", handleLogout)
        } else {
          // Add new event listener
          link.addEventListener("click", clickHandler)
        }
      }
    })
  }

  // Initialize bundle options for AirtelTigo
  function initializeBundles() {
    if (!bundleContainer) return

    // Clear existing bundle buttons
    bundleContainer.innerHTML = ""

    // Create bundle buttons for AirtelTigo
    AT_BUNDLES.forEach((bundle) => {
      const button = document.createElement("button")
      button.className =
        "bundle-btn border border-gray-300 rounded-lg py-1 px-3 hover:bg-blue-100 transition duration-300 text-sm"
      button.dataset.volume = bundle.volume
      button.dataset.price = bundle.price
      button.textContent = `${bundle.volume / 1000}GB`

      button.addEventListener("click", () => selectQuantity(button))
      bundleContainer.appendChild(button)
    })
  }

  function selectQuantity(button) {
    // Reset all buttons
    document.querySelectorAll(".bundle-btn").forEach((btn) => {
      btn.classList.remove("bg-blue-200")
    })

    // Highlight selected button
    button.classList.add("bg-blue-200")

    // Update selected values
    selectedQuantity = Number.parseInt(button.dataset.volume, 10)
    selectedPrice = Number.parseFloat(button.dataset.price)

    // Update UI
    if (selectedQuantityElement) {
      selectedQuantityElement.textContent = `CHOOSED: ${selectedQuantity} MB AirtelTigo - ₵${selectedPrice.toFixed(2)}`
      selectedQuantityElement.classList.remove("hidden")
    }

    // Show success toast
    Swal.fire({
      title: "Great Choice!",
      text: `You've selected ${selectedQuantity} MB AirtelTigo data bundle.`,
      icon: "success",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    })
  }

  async function sendDataBundle() {
    // Check if user is logged in
    const user = firebase.auth().currentUser
    if (!user) {
      redirectToAuth()
      return
    }

    // Validate phone number
    const phoneNumberInput = document.getElementById("phone-number")
    const phoneNumber = phoneNumberInput?.value
    if (!phoneNumber) {
      showErrorAlert("Don't forget to enter the beneficiary's phone number.")
      return
    }

    // Validate phone number format
    if (!/^\d{10}$/.test(phoneNumber)) {
      showErrorAlert("Please enter a valid 10-digit phone number.")
      phoneNumberInput.focus()
      return
    }

    // Validate bundle selection
    if (!selectedQuantity) {
      showInfoAlert("Please select a data bundle quantity. We have great options for you!")
      return
    }

    // Prevent multiple submissions
    if (isProcessingPayment) {
      showInfoAlert("Your request is already being processed. Please wait.")
      return
    }

    try {
      isProcessingPayment = true
      showSpinner()

      // Get user data
      const userData = await getUserData(user.uid)

      // Initialize payment with Paystack
      const response = await fetch("https://quickconnect-tb6d.onrender.com/api/initiate-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          network: selectedNetwork, // Always "at" for AirtelTigo
          phone: phoneNumber,
          volume: selectedQuantity,
          amount: selectedPrice,
          email: userData.email || user.email,
          fcmToken: userData.fcmToken || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "An unexpected error occurred")
      }

      const result = await response.json()

      if (result.status === "success") {
        // Store the reference in localStorage before redirecting
        localStorage.setItem("paymentReference", result.data.reference)
        localStorage.setItem("paymentPhone", phoneNumber)
        localStorage.setItem("paymentVolume", selectedQuantity)
        localStorage.setItem("paymentAmount", selectedPrice)
        localStorage.setItem("paymentNetwork", selectedNetwork)

        // Redirect to Paystack payment page
        window.location.href = result.data.authorization_url
      } else {
        throw new Error(result.message || "Failed to initialize payment")
      }
    } catch (error) {
      console.error("Error in sendDataBundle:", error)
      showErrorAlert("We encountered an issue while processing your request. Please try again or contact support.")
    } finally {
      isProcessingPayment = false
      hideSpinner()
    }
  }

  async function getUserData(userId) {
    try {
      const userRef = firebase.database().ref("users/" + userId)
      const snapshot = await userRef.once("value")
      return snapshot.val() || {}
    } catch (error) {
      console.error("Error getting user data:", error)
      return {}
    }
  }

  async function loadUserOrders(userId) {
    try {
      const ordersRef = firebase.database().ref("orders/" + userId)
      const snapshot = await ordersRef.orderByChild("timestamp").once("value")
      const orders = snapshot.val()

      if (orders && ordersContainer) {
        let ordersHtml = ""
        let atOrdersCount = 0

        Object.keys(orders)
          .reverse()
          .forEach((key) => {
            const order = orders[key]

            // Only show AirtelTigo orders
            if (order.network === "at") {
              atOrdersCount++

              // Determine if this is a pending order with successful payment
              const isPendingWithSuccessfulPayment = order.status === "pending" && order.paymentStatus === "success"

              ordersHtml += `
              <div class="bg-white p-4 rounded-lg shadow mb-4">
                <div class="flex justify-between items-center mb-2">
                  <p class="font-semibold">${order.volume} MB AirtelTigo to ${order.phone}</p>
                  <div>
                    ${
                      isPendingWithSuccessfulPayment
                        ? `<span class="inline-block px-2 py-1 text-xs rounded bg-blue-100 text-blue-800 mr-1">
                        Payment Success
                      </span>`
                        : ""
                    }
                    <span class="inline-block px-2 py-1 text-xs rounded ${
                      order.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : order.status === "pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                    }">
                      ${capitalizeFirstLetter(order.status)}
                    </span>
                  </div>
                </div>
                <p class="text-sm text-gray-600">Amount: ₵${Number.parseFloat(order.amount).toFixed(2)}</p>
                <p class="text-sm text-gray-600">Date: ${new Date(order.timestamp).toLocaleString()}</p>
                <p class="text-sm text-gray-600">Order ID: ${order.reference || "Pending"}</p>
                <p class="text-sm text-gray-600">Placed by: ${order.username}</p>
                
                ${
                  isPendingWithSuccessfulPayment
                    ? `<div class="mt-2 pt-2 border-t border-gray-200">
                    <p class="text-sm text-yellow-600">
                      <i data-feather="alert-circle" class="inline-block w-4 h-4 mr-1"></i>
                      Your payment was successful, but the data bundle is still processing. 
                      Please contact support if not received within 2 hours.
                    </p>
                  </div>`
                    : ""
                }
                
                ${
                  order.error
                    ? `<div class="mt-2 pt-2 border-t border-gray-200">
                    <p class="text-sm text-red-600">
                      <i data-feather="alert-triangle" class="inline-block w-4 h-4 mr-1"></i>
                      Error: ${order.error}
                    </p>
                  </div>`
                    : ""
                }
              </div>
            `
            }
          })

        if (atOrdersCount > 0) {
          ordersContainer.innerHTML = ordersHtml
        } else {
          ordersContainer.innerHTML = "<p>You have no AirtelTigo orders yet.</p>"
        }

        // Re-initialize Feather icons for new content
        if (typeof feather !== "undefined") {
          feather.replace()
        }
      } else if (ordersContainer) {
        ordersContainer.innerHTML = "<p>You have no AirtelTigo orders yet.</p>"
      }
    } catch (error) {
      console.error("Error loading user orders:", error)
      if (ordersContainer) {
        ordersContainer.innerHTML = "<p>Error loading orders. Please try again later.</p>"
      }
    }
  }

  function handleLogout() {
    firebase
      .auth()
      .signOut()
      .then(() => {
        Swal.fire({
          title: "Logged Out",
          text: "You successfully logged out. Have a great day!",
          icon: "success",
          showConfirmButton: false,
          timer: 1500,
          timerProgressBar: true,
        })
        window.location.href = "index.html"
      })
      .catch((error) => {
        console.error("Error during logout:", error)
        showErrorAlert("Oops! We encountered an issue while logging you out: " + error.message)
      })
  }

  function redirectToAuth() {
    window.location.href = "auth.html"
  }

  function showSpinner() {
    spinner?.classList.remove("hidden")
  }

  function hideSpinner() {
    spinner?.classList.add("hidden")
  }

  function showErrorAlert(message) {
    Swal.fire({
      title: "Oops!",
      text: message,
      icon: "error",
      confirmButtonColor: "#0046be",
    })
  }

  function showInfoAlert(message) {
    Swal.fire({
      title: "Information",
      text: message,
      icon: "info",
      confirmButtonColor: "#0046be",
    })
  }

  function showSuccessAlert(title, message) {
    Swal.fire({
      title: title,
      text: message,
      icon: "success",
      confirmButtonColor: "#0046be",
    })
  }

  async function verifyPayment(reference, userId) {
    if (isVerifyingPayment) {
      return
    }

    try {
      isVerifyingPayment = true
      showSpinner()

      const result = await checkPaymentStatus(reference)
      console.log("Payment verification result:", result)

      // Get order details from localStorage
      const phone = localStorage.getItem("paymentPhone")
      const volume = localStorage.getItem("paymentVolume")
      const amount = localStorage.getItem("paymentAmount")
      const network = localStorage.getItem("paymentNetwork") || "at"

      // Verify this is an AirtelTigo order
      if (network !== "at") {
        // Not an AirtelTigo order, don't process it here
        isVerifyingPayment = false
        hideSpinner()
        return
      }

      // Get user data for username
      const userData = await getUserData(userId)
      const username = userData.username || "User"

      // Handle different payment scenarios
      if (result.status === "success") {
        // Payment and Hubnet both successful
        const orderKey = await createOrder(userId, {
          network,
          phone,
          volume,
          amount,
          reference,
          status: "completed",
          paymentStatus: "success",
          hubnetStatus: "success",
          username: username,
          hubnetResponse: result.data?.hubnetResponse || null,
          timestamp: firebase.database.ServerValue.TIMESTAMP,
          lastUpdated: firebase.database.ServerValue.TIMESTAMP,
        })

        Swal.fire({
          title: "Payment Successful!",
          html: `
          <p>Your AirtelTigo data bundle has been processed successfully!</p>
          <p class="mt-3"><strong>Reference ID:</strong> ${reference}</p>
          <p><strong>Amount:</strong> ₵${Number.parseFloat(amount).toFixed(2)}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Data Bundle:</strong> ${volume} MB AirtelTigo</p>
        `,
          icon: "success",
          confirmButtonColor: "#0046be",
        })
      } else if (result.status === "pending" || result.paymentStatus === "success") {
        // Payment successful but Hubnet failed or is pending
        const orderKey = await createOrder(userId, {
          network,
          phone,
          volume,
          amount,
          reference,
          status: "pending",
          paymentStatus: "success",
          hubnetStatus: result.hubnetStatus || "pending",
          username: username,
          error: result.error || null,
          timestamp: firebase.database.ServerValue.TIMESTAMP,
          lastUpdated: firebase.database.ServerValue.TIMESTAMP,
        })

        Swal.fire({
          title: "Payment Successful!",
          html: `
          <p>Your payment was successful, but your AirtelTigo data bundle is still processing.</p>
          <p>If you don't receive your data within 2 hours, please contact support with your reference ID.</p>
          <p class="mt-3"><strong>Reference ID:</strong> ${reference}</p>
          <p><strong>Amount:</strong> ₵${Number.parseFloat(amount).toFixed(2)}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Data Bundle:</strong> ${volume} MB AirtelTigo</p>
        `,
          icon: "info",
          confirmButtonColor: "#0046be",
        })
      } else if (result.status === "failed") {
        // Payment failed
        let errorMessage = "Your payment failed. Please try again or use a different payment method."

        // Check for specific error messages
        if (result.data && result.data.gateway_response) {
          if (result.data.gateway_response.includes("LOW_BALANCE")) {
            errorMessage =
              "Payment failed: Insufficient balance in your mobile money account. Please top up and try again."
          } else if (result.data.gateway_response.includes("LIMIT_REACHED")) {
            errorMessage =
              "Payment failed: You have reached your transaction limit. Please try again later or contact your mobile money provider."
          } else if (result.data.gateway_response.includes("NOT_ALLOWED")) {
            errorMessage =
              "Payment failed: This transaction is not allowed for your account. Please contact your mobile money provider."
          } else {
            errorMessage = `Payment failed: ${result.data.gateway_response}. Please try again or use a different payment method.`
          }
        }

        // Show detailed error message
        Swal.fire({
          title: "Payment Failed",
          text: errorMessage,
          icon: "error",
          confirmButtonColor: "#0046be",
        })

        // Log the failed payment attempt in Firebase for tracking
        await createOrder(userId, {
          network,
          phone,
          volume,
          amount,
          reference,
          status: "failed",
          paymentStatus: "failed",
          username: username,
          error: result.data?.gateway_response || "Payment failed",
          timestamp: firebase.database.ServerValue.TIMESTAMP,
        })
      } else {
        showErrorAlert(result.message || "Payment verification failed. Please try again or contact support.")
      }

      // Refresh orders list
      await loadUserOrders(userId)
    } catch (error) {
      console.error("Error verifying payment:", error)
      showErrorAlert("Failed to verify payment. Please try again or contact support.")
    } finally {
      isVerifyingPayment = false
      hideSpinner()

      // Clear localStorage
      localStorage.removeItem("paymentReference")
      localStorage.removeItem("paymentPhone")
      localStorage.removeItem("paymentVolume")
      localStorage.removeItem("paymentAmount")
      localStorage.removeItem("paymentNetwork")
    }
  }

  async function createOrder(userId, orderData) {
    try {
      const ordersRef = firebase.database().ref("orders/" + userId)
      const newOrderRef = ordersRef.push()
      await newOrderRef.set({
        ...orderData,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
      })
      return newOrderRef.key
    } catch (error) {
      console.error("Error creating order:", error)
      throw error
    }
  }

  async function checkPaymentStatus(reference) {
    try {
      const response = await fetch(`https://quickconnect-tb6d.onrender.com/api/verify-payment/${reference}`)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      console.log("Payment status API response:", result)

      // Handle different response formats
      if (result.status === "failed" && response.status === 200) {
        return {
          status: "failed",
          message: result.message || "Payment failed",
          data: result.data,
        }
      } else if (result.status === "pending" && result.paymentStatus === "success") {
        // This is a case where payment succeeded but Hubnet failed
        return {
          status: "pending",
          paymentStatus: "success",
          hubnetStatus: "failed",
          message: result.message || "Payment successful but data bundle processing is pending",
          error: result.error || null,
        }
      }

      return result
    } catch (error) {
      console.error("Error checking payment status:", error)
      return { status: "error", message: "Failed to verify payment status" }
    }
  }

  async function loadUserAccount(userId) {
    try {
      const userRef = firebase.database().ref("users/" + userId)
      const snapshot = await userRef.once("value")
      const userData = snapshot.val()

      if (userData) {
        const accountInfo = document.getElementById("account-info")
        if (accountInfo) {
          accountInfo.innerHTML = `
            <p class="mb-2"><strong>Name:</strong> ${userData.username || "Not set"}</p>
            <p class="mb-2"><strong>Email:</strong> ${userData.email || "Not set"}</p>
            <p class="mb-2"><strong>Phone:</strong> ${userData.phone || "Not set"}</p>
          `
        }

        const profileImage = document.getElementById("profile-image")
        if (profileImage) {
          profileImage.textContent = (userData.username || "U").charAt(0).toUpperCase()
        }

        // Show logout button
        if (logoutButton) {
          logoutButton.classList.remove("hidden")
        }
      }
    } catch (error) {
      console.error("Error loading user account:", error)
      const accountInfo = document.getElementById("account-info")
      if (accountInfo) {
        accountInfo.innerHTML = "<p class='text-red-500'>Error loading account information. Please try again later.</p>"
      }
    }
  }

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1)
  }

  // Initialize the bundle options
  initializeBundles()
})
