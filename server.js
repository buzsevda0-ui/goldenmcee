const express = require("express");
const bodyParser = require("body-parser");
const { Rcon } = require("rcon-client");

const app = express();
app.use(bodyParser.json());

const rcon = new Rcon({
    host: "127.0.0.1",
    port: 25575,
    password: "123456"
});

// VIP VERME API
app.post("/buy", async (req, res) => {
    const { username, rank } = req.body;

    try {
        await rcon.connect();

        let command = `lp user ${username} parent set ${rank}`;

        await rcon.send(command);
        await rcon.end();

        res.json({ status: "ok" });
    } catch (err) {
        res.json({ status: "error", error: err.message });
    }
});

app.listen(3000, () => {
    console.log("Server çalışıyor: http://localhost:3000");
});
