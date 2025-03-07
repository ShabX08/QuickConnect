const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys")
const { Boom } = require("@hapi/boom")
const fs = require("fs")
const path = require("path")
const qrcode = require("qrcode-terminal")
const qrcodeWeb = require("qrcode")
const figlet = require("figlet")
const chalk = require("chalk")
const express = require("express")
const pino = require("pino")

// Create a Pino logger
const logger = pino({ level: "warn" })

// Simple database to store user data and statuses
const DB_FILE = path.join(__dirname, "bot_db.json")
let db = { warned: {}, statuses: {} }

// Web server configuration
let PORT = process.env.PORT || 3000
const app = express()
let currentQR = null
let server = null

// Load database if exists
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  } catch (error) {
    console.error("Error loading database:", error)
  }
}

// Save database
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// Fancy console log
function fancyLog(text) {
  console.log(chalk.cyan(figlet.textSync(text, { font: "Small" })))
}

// QR Code display configuration - EXTRA SMALL
const QR_CONFIG = {
  small: true,
  scale: 1,
  width: 30,
  renderTo: "terminal",
}

// Setup web server for QR code access
function setupWebServer() {
  return new Promise((resolve, reject) => {
    // QR code endpoint
    app.get("/qr", (req, res) => {
      if (!currentQR) {
        return res.status(404).send("QR code not available yet. Please try again in a few moments.")
      }

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>WhatsApp Bot QR Code</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                background-color: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                max-width: 90%;
              }
              h1 {
                color: #128C7E;
              }
              .qr-container {
                margin: 20px 0;
              }
              p {
                color: #666;
                margin-bottom: 20px;
              }
              .refresh {
                margin-top: 20px;
                color: #888;
                font-size: 0.9em;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>WhatsApp Bot QR Code</h1>
              <p>Scan this QR code with your WhatsApp to connect to the bot</p>
              <div class="qr-container">
                <img src="data:image/png;base64,${currentQR}" alt="WhatsApp QR Code" />
              </div>
              <p class="refresh">QR code expires after scanning. Refresh if needed.</p>
            </div>
          </body>
        </html>
      `)
    })

    // Add a root route to redirect to QR page
    app.get("/", (req, res) => {
      res.redirect("/qr")
    })

    // Start the server
    server = app
      .listen(PORT, "0.0.0.0", () => {
        console.log(chalk.green(`✓ Web server running on port ${PORT}`))

        // Get public URL information
        const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`
        console.log(chalk.blue(`✓ Access QR code at: ${publicUrl}/qr`))

        if (publicUrl.includes("localhost")) {
          console.log(
            chalk.yellow(
              `To make this accessible from the internet, you can use a service like ngrok or deploy to a hosting service.`,
            ),
          )
          console.log(chalk.yellow(`Example with ngrok: npx ngrok http ${PORT}`))
        }

        resolve()
      })
      .on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.log(chalk.yellow(`Port ${PORT} is busy, trying next port...`))
          PORT++
          server.close()
          setupWebServer().then(resolve).catch(reject)
        } else {
          reject(err)
        }
      })
  })
}

// Command handler
async function handleCommand(sock, msg, from, sender, groupMetadata, text) {
  const args = text.split(" ")
  const command = args[0].toLowerCase()
  const isAdmin = groupMetadata?.participants?.find((p) => p.id === sender)?.admin
  const isBotAdmin = groupMetadata?.participants?.find((p) => p.id === sock.user.id)?.admin

  // Help command
  if (command === "help") {
    const commands = [
      "*🌟 Available Commands 🌟*",
      "",
      "*📚 General Commands:*",
      "• !help - Show this help message",
      "• !ping - Check if bot is online",
      "• !groupinfo - Show group information",
      "• !tagall [message] - Tag all members",
      "• !warn @user - Warn a user",
      "• !unwarn @user - Remove warning from a user",
      "• !savequote [text] - Save a quote",
      "• !getquote - Get a random saved quote",
      "• !weather [city] - Get weather information",
      "• !joke - Get a random joke",
      "• !flip - Flip a coin",
      "• !roll [number] - Roll a dice",
      "• !calculate [expression] - Calculate a mathematical expression",
      "",
      "*👑 Admin Commands:*",
      "• !kick @user - Remove a user from group",
      "• !add number - Add a user to group",
      "• !broadcast message - Send a broadcast message",
      "• !restart - Restart the bot",
      "",
      "Note: Replace @user with an actual mention, and [text] with appropriate content.",
      "Admin commands can only be used by group admins.",
    ].join("\n")

    return sock.sendMessage(from, { text: commands }, { quoted: msg })
  }

  // Ping command
  if (command === "ping") {
    return sock.sendMessage(from, { text: "Pong! 🏓 Bot is online and ready!" }, { quoted: msg })
  }

  // Group info command
  if (command === "groupinfo" && groupMetadata) {
    const info = [
      `*📊 Group Information 📊*`,
      ``,
      `*🏷️ Name:* ${groupMetadata.subject}`,
      `*🆔 ID:* ${from}`,
      `*👑 Created By:* ${groupMetadata.owner || "Unknown"}`,
      `*📅 Created On:* ${new Date(groupMetadata.creation * 1000).toLocaleString()}`,
      `*👥 Member Count:* ${groupMetadata.participants.length}`,
      `*📝 Description:* ${groupMetadata.desc || "No description"}`,
    ].join("\n")

    return sock.sendMessage(from, { text: info }, { quoted: msg })
  }

  // Tag all command
  if (command === "tagall") {
    if (!groupMetadata) {
      return sock.sendMessage(from, { text: "This command can only be used in groups!" }, { quoted: msg })
    }

    const message = args.slice(1).join(" ") || "Hello everyone!"
    const mentions = groupMetadata.participants.map((participant) => participant.id)

    let text = `*📢 Attention Everyone! 📢*\n\n${message}\n\n`
    for (const participant of groupMetadata.participants) {
      text += `@${participant.id.split("@")[0]}\n`
    }

    return sock.sendMessage(
      from,
      {
        text: text,
        mentions: mentions,
      },
      { quoted: msg },
    )
  }

  // Warn command
  if (command === "warn") {
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
    if (!mentioned || mentioned.length === 0) {
      return sock.sendMessage(from, { text: "Please mention a user to warn!" }, { quoted: msg })
    }

    const targetUser = mentioned[0]
    if (!db.warned[targetUser]) {
      db.warned[targetUser] = 0
    }

    db.warned[targetUser]++
    saveDB()

    return sock.sendMessage(
      from,
      {
        text: `⚠️ @${targetUser.split("@")[0]} has been warned! (${db.warned[targetUser]} warnings)`,
        mentions: [targetUser],
      },
      { quoted: msg },
    )
  }

  // Unwarn command
  if (command === "unwarn") {
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
    if (!mentioned || mentioned.length === 0) {
      return sock.sendMessage(from, { text: "Please mention a user to remove warning!" }, { quoted: msg })
    }

    const targetUser = mentioned[0]
    if (db.warned[targetUser] && db.warned[targetUser] > 0) {
      db.warned[targetUser]--
      if (db.warned[targetUser] === 0) {
        delete db.warned[targetUser]
      }
      saveDB()
    }

    return sock.sendMessage(
      from,
      {
        text: `✅ Warning removed from @${targetUser.split("@")[0]}!`,
        mentions: [targetUser],
      },
      { quoted: msg },
    )
  }

  // Save quote command
  if (command === "savequote") {
    const quote = args.slice(1).join(" ")
    if (!quote) {
      return sock.sendMessage(from, { text: "Please provide a quote to save!" }, { quoted: msg })
    }

    if (!db.statuses[from]) {
      db.statuses[from] = []
    }
    db.statuses[from].push(quote)
    saveDB()

    return sock.sendMessage(from, { text: "✅ Quote saved successfully!" }, { quoted: msg })
  }

  // Get quote command
  if (command === "getquote") {
    if (!db.statuses[from] || db.statuses[from].length === 0) {
      return sock.sendMessage(from, { text: "No quotes saved for this group!" }, { quoted: msg })
    }

    const randomQuote = db.statuses[from][Math.floor(Math.random() * db.statuses[from].length)]
    return sock.sendMessage(from, { text: `📜 Random Quote:\n\n"${randomQuote}"` }, { quoted: msg })
  }

  // Weather command (Note: This is a mock implementation)
  if (command === "weather") {
    const city = args.slice(1).join(" ")
    if (!city) {
      return sock.sendMessage(from, { text: "Please provide a city name!" }, { quoted: msg })
    }

    const mockWeather = ["Sunny", "Cloudy", "Rainy", "Windy", "Snowy"][Math.floor(Math.random() * 5)]
    const mockTemp = Math.floor(Math.random() * 35) + 5 // Random temperature between 5°C and 40°C

    return sock.sendMessage(from, { text: `🌤️ Weather in ${city}:\n${mockWeather}, ${mockTemp}°C` }, { quoted: msg })
  }

  // Joke command
  if (command === "joke") {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "Why did the scarecrow win an award? He was outstanding in his field!",
      "Why don't eggs tell jokes? They'd crack each other up!",
      "Why don't skeletons fight each other? They don't have the guts!",
      "What do you call a fake noodle? An impasta!",
    ]
    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)]
    return sock.sendMessage(from, { text: `😂 Here's a joke:\n\n${randomJoke}` }, { quoted: msg })
  }

  // Flip coin command
  if (command === "flip") {
    const result = Math.random() < 0.5 ? "Heads" : "Tails"
    return sock.sendMessage(from, { text: `🪙 Coin flip result: ${result}` }, { quoted: msg })
  }

  // Roll dice command
  if (command === "roll") {
    const sides = Number.parseInt(args[1]) || 6
    const result = Math.floor(Math.random() * sides) + 1
    return sock.sendMessage(from, { text: `🎲 Dice roll result (${sides}-sided): ${result}` }, { quoted: msg })
  }

  // Calculate command
  if (command === "calculate") {
    const expression = args.slice(1).join(" ")
    if (!expression) {
      return sock.sendMessage(from, { text: "Please provide a mathematical expression!" }, { quoted: msg })
    }

    try {
      const result = eval(expression)
      return sock.sendMessage(from, { text: `🧮 Result: ${expression} = ${result}` }, { quoted: msg })
    } catch (error) {
      return sock.sendMessage(from, { text: "Invalid expression. Please try again." }, { quoted: msg })
    }
  }

  // Admin commands
  if (["kick", "add", "broadcast", "restart"].includes(command)) {
    // Check if user is admin
    if (!isAdmin) {
      return sock.sendMessage(from, { text: "You need to be an admin to use this command!" }, { quoted: msg })
    }

    // Handle kick command
    if (command === "kick") {
      if (!isBotAdmin) {
        return sock.sendMessage(from, { text: "I need to be an admin to kick users!" }, { quoted: msg })
      }

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
      if (!mentioned || mentioned.length === 0) {
        return sock.sendMessage(from, { text: "Please mention a user to kick!" }, { quoted: msg })
      }

      const targetUser = mentioned[0]

      try {
        await sock.groupParticipantsUpdate(from, [targetUser], "remove")
        return sock.sendMessage(
          from,
          {
            text: `👢 @${targetUser.split("@")[0]} has been kicked from the group!`,
            mentions: [targetUser],
          },
          { quoted: msg },
        )
      } catch (error) {
        return sock.sendMessage(from, { text: "Failed to kick user: " + error.message }, { quoted: msg })
      }
    }

    // Handle add command
    if (command === "add") {
      if (!isBotAdmin) {
        return sock.sendMessage(from, { text: "I need to be an admin to add users!" }, { quoted: msg })
      }

      if (args.length < 2) {
        return sock.sendMessage(from, { text: "Please provide a number to add!" }, { quoted: msg })
      }

      let number = args[1].replace(/[^0-9]/g, "")
      if (!number.startsWith("1") && !number.startsWith("1")) {
        number = "1" + number
      }
      if (!number.includes("@s.whatsapp.net")) {
        number = number + "@s.whatsapp.net"
      }

      try {
        await sock.groupParticipantsUpdate(from, [number], "add")
        return sock.sendMessage(from, { text: `✅ User ${args[1]} has been added to the group!` }, { quoted: msg })
      } catch (error) {
        return sock.sendMessage(from, { text: "Failed to add user: " + error.message }, { quoted: msg })
      }
    }

    // Broadcast command
    if (command === "broadcast") {
      const message = args.slice(1).join(" ")
      if (!message) {
        return sock.sendMessage(from, { text: "Please provide a message to broadcast!" }, { quoted: msg })
      }

      return sock.sendMessage(from, {
        text: `*📢 BROADCAST*\n\n${message}`,
      })
    }

    // Restart command
    if (command === "restart") {
      sock.sendMessage(from, { text: "🔄 Restarting bot..." }, { quoted: msg }).then(() => process.exit(0))
    }
  }
}

// Handle message extraction
function extractMessageContent(msg) {
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    ""
  ).trim()
}

// Handle QR code generation
async function generateQRCode(qr) {
  // Generate QR code for web display
  try {
    currentQR = await qrcodeWeb.toDataURL(qr, {
      errorCorrectionLevel: "L",
      margin: 1,
      scale: 4,
      width: 200,
    })
    currentQR = currentQR.split(",")[1] // Remove the data URL prefix
  } catch (err) {
    console.error("Failed to generate QR code for web:", err)
  }

  // Generate extra small QR code for terminal
  console.log("\n")
  console.log(chalk.yellow("┌───────────────────────┐"))
  console.log(chalk.yellow("│     SCAN QR CODE      │"))
  console.log(chalk.yellow("│   (Extra Small Size)  │"))
  console.log(chalk.yellow("└───────────────────────┘"))

  // Use custom settings for smallest possible QR in terminal
  qrcode.generate(qr, {
    small: true,
    scale: 1,
    width: 2,
    margin: 0,
  })

  // Get public URL information
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`

  console.log(chalk.yellow("┌───────────────────────────────────┐"))
  console.log(chalk.yellow("│  Access QR code via web browser:  │"))
  console.log(chalk.yellow(`│  ${publicUrl}/qr`.padEnd(35) + " │"))
  console.log(chalk.yellow("└───────────────────────────────────┘"))
}

// Connection manager
class ConnectionManager {
  constructor() {
    this.sock = null
    this.retries = 0
    this.maxRetries = 5
    this.retryDelay = 5000
    this.qrRetries = 0
    this.maxQrRetries = 3
    this.qrCode = null
  }

  async start() {
    try {
      // Create auth state
      const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_info"))

      // Create socket connection with optimized settings
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Disable default QR printing
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 90000, // Extended timeout for QR scanning
        connectTimeoutMs: 60000,
        browser: ["WhatsApp Bot", "Chrome", "103.0.5060.114"],
        logger: logger, // Use the Pino logger
      })

      // Save credentials when updated
      this.sock.ev.on("creds.update", saveCreds)

      // Handle connection updates
      this.sock.ev.on("connection.update", this.handleConnectionUpdate.bind(this))

      this.setupMessageHandlers()
      this.setupGroupHandlers()

      return this.sock
    } catch (error) {
      console.error("Error in start method:", error)
      this.handleReconnection()
    }
  }

  async handleConnectionUpdate({ connection, lastDisconnect, qr }) {
    try {
      if (qr) {
        this.qrCode = qr
        if (this.qrRetries < this.maxQrRetries) {
          await generateQRCode(this.qrCode)
          this.qrRetries++
        } else {
          console.log(chalk.red("Max QR code retries reached. Please restart the bot manually."))
          this.sock?.ws.close()
          process.exit(1)
        }
      }

      if (connection === "close") {
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut

        console.log(
          chalk.red(`Connection closed due to ${lastDisconnect?.error?.message || "unknown error"}`),
          chalk.green(`Reconnecting: ${shouldReconnect ? "Yes" : "No"}`),
        )

        if (shouldReconnect) {
          this.handleReconnection()
        }
      } else if (connection === "open") {
        // Clear QR code when connected
        currentQR = null
        this.retries = 0
        this.qrRetries = 0
        this.qrCode = null

        fancyLog("Bot Connected!")
        console.log(chalk.green("✓ Successfully connected to WhatsApp"))
        console.log(chalk.green("✓ Bot is now online and ready to use"))
      }
    } catch (error) {
      console.error("Error in handleConnectionUpdate:", error)
      this.handleReconnection()
    }
  }

  handleReconnection() {
    if (this.retries < this.maxRetries) {
      this.retries++
      console.log(chalk.yellow(`Reconnection attempt ${this.retries} of ${this.maxRetries}`))
      setTimeout(() => this.start(), this.retryDelay)
    } else {
      console.error(chalk.red("Max reconnection attempts reached. Please restart the bot manually."))
      process.exit(1)
    }
  }

  setupMessageHandlers() {
    // Handle messages
    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith("@g.us")
        const sender = msg.key.participant || from

        // Get message content
        const body = extractMessageContent(msg)

        // Handle group-specific actions
        let groupMetadata = null
        if (isGroup) {
          groupMetadata = await this.sock.groupMetadata(from)

          // Handle commands
          if (body.startsWith("!")) {
            const text = body.slice(1)
            await handleCommand(this.sock, msg, from, sender, groupMetadata, text)
          }
        }

        // Log message for debugging
        console.log(chalk.green(`[${new Date().toLocaleString()}] Message from ${sender} in ${from}: ${body}`))
      } catch (error) {
        console.error("Error processing message:", error)
      }
    })
  }

  setupGroupHandlers() {
    // Handle group participants update (joins/leaves)
    this.sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
      try {
        // Get group metadata
        const groupMetadata = await this.sock.groupMetadata(id)

        // Handle new participants
        if (action === "add") {
          for (const participant of participants) {
            // Send welcome message
            try {
              await this.sock.sendMessage(id, {
                text: `👋 Welcome @${participant.split("@")[0]} to ${groupMetadata.subject}!`,
                mentions: [participant],
              })
            } catch (error) {
              console.error("Error sending welcome message:", error)
            }
          }
        }

        // Handle participants who left
        if (action === "remove") {
          for (const participant of participants) {
            // Send goodbye message
            try {
              await this.sock.sendMessage(id, {
                text: `👋 @${participant.split("@")[0]} has left the group. Goodbye!`,
                mentions: [participant],
              })
            } catch (error) {
              console.error("Error sending goodbye message:", error)
            }
          }
        }
      } catch (error) {
        console.error("Error handling group update:", error)
      }
    })
  }
}

// Start the bot
async function main() {
  try {
    fancyLog("Starting WhatsApp Bot")
    console.log(chalk.blue("Initializing connection..."))

    await setupWebServer()

    const connectionManager = new ConnectionManager()
    await connectionManager.start()
  } catch (error) {
    console.error("Fatal error:", error)
    process.exit(1)
  }
}

// If running directly, start the bot
if (require.main === module) {
  main()
}

// Export the main function for potential use in other scripts
module.exports = main

