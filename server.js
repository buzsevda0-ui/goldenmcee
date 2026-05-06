const express = require("express");
const cors = require("cors");
const { Rcon } = require("rcon-client");

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ BURAYI DÜZENLE
const RCON_CONFIG = {
    host: "127.0.0.1", // Sunucu IP
    port: 25575,
    password: "goldenmc2025"
};

// Basit güvenlik (site ile eşleşecek)
const ADMIN_TOKEN = "umut123";

// RCON bağlantısı
async function sendCommand(cmd) {
    try {
        const rcon = await Rcon.connect(RCON_CONFIG);
        const res = await rcon.send(cmd);
        await rcon.end();
        return res;
    } catch (err) {
        return "HATA: " + err.message;
    }
}

// API endpoint
app.post("/command", async (req, res) => {
    const { token, command } = req.body;

    if (token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: "Yetkisiz!" });
    }

    if (!command) {
        return res.status(400).json({ error: "Komut boş!" });
    }

    const result = await sendCommand(command);
    res.json({ result });
});

// Test
app.get("/", (req, res) => {
    res.send("RCON API Çalışıyor 🚀");
});

app.listen(3000, () => {
    console.log("Server çalışıyor: http://localhost:3000");
});
