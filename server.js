const express = require("express");
const { Rcon } = require("rcon-client");

const app = express();
app.use(express.json());

const rconConfig = {
    host: "BURAYA_IP_YAZ", // ÖRN: node123.falixsrv.me
    port: 25575,
    password: "goldenmc2025"
};

app.post("/cmd", async (req, res) => {
    try {
        const rcon = await Rcon.connect(rconConfig);
        const result = await rcon.send(req.body.command);
        await rcon.end();

        res.json({ result });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.listen(3000, () => console.log("Çalışıyor"));
