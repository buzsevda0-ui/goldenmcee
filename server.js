// ═══════════════════════════════════════════════════
//  GoldenMC Backend — server.js
//  Render.com veya Railway'e deploy et
//  Node.js 18+
// ═══════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const net      = require('net');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── AYARLAR ──────────────────────────────────────────
const CONFIG = {
  // Minecraft sunucu bilgileri
  MC_HOST : process.env.MC_HOST  || 'goldenmcee.falixsvr.me',
  MC_PORT : parseInt(process.env.MC_PORT || '25575'),   // RCON portu

  // RCON şifresi (Falix panelinde ayarlarsın)
  RCON_PASS: process.env.RCON_PASS || 'goldenrcon123',

  // PayTR bilgileri (PayTR panelinden al)
  PAYTR_MERCHANT_ID  : process.env.PAYTR_MERCHANT_ID   || 'MERCHANT_ID',
  PAYTR_MERCHANT_KEY : process.env.PAYTR_MERCHANT_KEY  || 'MERCHANT_KEY',
  PAYTR_MERCHANT_SALT: process.env.PAYTR_MERCHANT_SALT || 'MERCHANT_SALT',

  // Admin şifresi
  ADMIN_PASS: process.env.ADMIN_PASS || 'Admin2025!',
};

// Rank → LuckPerms grup adı eşlemesi
const RANK_GROUPS = {
  'VIP'       : 'vip',
  'VIP+'      : 'vipplus',
  'KVIP'      : 'kvip',
  'KVIP+'     : 'kvipplus',
  'GoldenVIP' : 'goldenvip',
  'GoldenVIP+': 'goldenvipplus',
};

// ── MİDDLEWARE ────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── RCON CLIENT ───────────────────────────────────────
// Minecraft RCON protokolü — bağımsız, paket bağımlılığı yok
function rconCommand(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let authenticated = false;
    let buf = Buffer.alloc(0);
    const TIMEOUT = 8000;

    socket.setTimeout(TIMEOUT);
    socket.connect(port, host, () => {
      // Auth paketi gönder
      socket.write(buildRconPacket(1, 3, password));
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 12) {
        const len = buf.readInt32LE(0);
        if (buf.length < len + 4) break;
        const id   = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.slice(12, len + 2).toString('utf8').replace(/\0/g, '');
        buf = buf.slice(len + 4);

        if (!authenticated) {
          if (id === -1) { socket.destroy(); reject(new Error('RCON auth failed')); return; }
          authenticated = true;
          // Komutu gönder
          socket.write(buildRconPacket(2, 2, command));
        } else {
          socket.destroy();
          resolve(body);
        }
      }
    });

    socket.on('timeout', () => { socket.destroy(); reject(new Error('RCON timeout')); });
    socket.on('error', err => reject(err));
  });
}

function buildRconPacket(id, type, body) {
  const bodyBuf = Buffer.from(body + '\0\0', 'utf8');
  const packet  = Buffer.allocUnsafe(4 + 4 + 4 + bodyBuf.length);
  packet.writeInt32LE(8 + bodyBuf.length, 0);
  packet.writeInt32LE(id,   4);
  packet.writeInt32LE(type, 8);
  bodyBuf.copy(packet, 12);
  return packet;
}

// ── MC SERVER STATUS (SLP ping) ────────────────────────
function pingMinecraft(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    socket.setTimeout(5000);

    socket.connect(port || 25565, host, () => {
      // Handshake + Status Request
      const hs = buildVarInt(0x00);
      const hostBuf = Buffer.from(host, 'utf8');
      const pkt = Buffer.concat([
        hs,
        buildVarInt(-1 & 0x7FFFFFFF),
        buildVarInt(hostBuf.length), hostBuf,
        Buffer.from([0x63, 0xDD]),  // port 25565
        buildVarInt(1)
      ]);
      const hsWrapped = wrapPacket(pkt);
      const statusReq = wrapPacket(buildVarInt(0x00));
      socket.write(Buffer.concat([hsWrapped, statusReq]));
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      try {
        let offset = 0;
        const [pktLen, pktLenBytes] = readVarInt(buf, offset);
        offset += pktLenBytes;
        if (buf.length < offset + pktLen) return;
        const [, pidBytes] = readVarInt(buf, offset);
        offset += pidBytes;
        const [jsonLen, jsonLenBytes] = readVarInt(buf, offset);
        offset += jsonLenBytes;
        const json = buf.slice(offset, offset + jsonLen).toString('utf8');
        const data = JSON.parse(json);
        socket.destroy();
        resolve({
          online : true,
          players: { online: data.players?.online || 0, max: data.players?.max || 0 },
          version: data.version?.name || 'Unknown',
          motd   : typeof data.description === 'string'
                    ? data.description
                    : data.description?.text || ''
        });
      } catch { /* wait for more data */ }
    });

    socket.on('timeout', () => { socket.destroy(); resolve({ online: false }); });
    socket.on('error',   () => resolve({ online: false }));
  });
}

function buildVarInt(val) {
  const bytes = [];
  do {
    let b = val & 0x7F;
    val >>>= 7;
    if (val !== 0) b |= 0x80;
    bytes.push(b);
  } while (val !== 0);
  return Buffer.from(bytes);
}
function wrapPacket(data) {
  return Buffer.concat([buildVarInt(data.length), data]);
}
function readVarInt(buf, offset) {
  let val = 0, shift = 0, bytesRead = 0;
  let b;
  do {
    b = buf[offset + bytesRead];
    val |= (b & 0x7F) << shift;
    shift += 7; bytesRead++;
  } while (b & 0x80);
  return [val, bytesRead];
}

// ══════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════

// ── GET /api/status ── Sunucu durumu
app.get('/api/status', async (req, res) => {
  try {
    const status = await pingMinecraft(CONFIG.MC_HOST, 25565);
    res.json({ ok: true, ...status });
  } catch (e) {
    res.json({ ok: false, online: false, error: e.message });
  }
});

// ── GET /api/players ── Oyuncu sayısı
app.get('/api/players', async (req, res) => {
  try {
    const status = await pingMinecraft(CONFIG.MC_HOST, 25565);
    if (status.online) {
      res.json({ ok: true, online: status.players.online, max: status.players.max });
    } else {
      res.json({ ok: false, online: 0, max: 0 });
    }
  } catch {
    res.json({ ok: false, online: 0, max: 0 });
  }
});

// ── GET /api/user/:username ── Oyuncu rank sorgu
app.get('/api/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    // RCON ile LuckPerms'ten rank sorgula
    const result = await rconCommand(
      CONFIG.MC_HOST, CONFIG.MC_PORT, CONFIG.RCON_PASS,
      `lp user ${username} info`
    );
    // Rank adını parse et
    let rank = 'Üye';
    for (const [display, group] of Object.entries(RANK_GROUPS)) {
      if (result.toLowerCase().includes(group)) { rank = display; break; }
    }
    res.json({ ok: true, username, rank });
  } catch (e) {
    // RCON bağlanamadıysa sadece kullanıcıyı doğrula
    res.json({ ok: true, username, rank: 'Üye', rconError: e.message });
  }
});

// ── POST /api/rank ── Rank ver (admin)
app.post('/api/rank', async (req, res) => {
  const { adminPass, username, rank } = req.body;
  if (adminPass !== CONFIG.ADMIN_PASS) {
    return res.status(403).json({ ok: false, error: 'Yetkisiz erişim' });
  }
  const group = RANK_GROUPS[rank];
  if (!group) return res.status(400).json({ ok: false, error: 'Geçersiz rank' });

  try {
    const cmd = `lp user ${username} parent set ${group}`;
    const result = await rconCommand(CONFIG.MC_HOST, CONFIG.MC_PORT, CONFIG.RCON_PASS, cmd);
    res.json({ ok: true, username, rank, group, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/rcon-test ── RCON bağlantı testi
app.get('/api/rcon-test', async (req, res) => {
  try {
    const result = await rconCommand(CONFIG.MC_HOST, CONFIG.MC_PORT, CONFIG.RCON_PASS, 'list');
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── POST /api/payment/start ── PayTR ödeme başlat
app.post('/api/payment/start', async (req, res) => {
  const { username, email, packageName, userIp } = req.body;
  if (!username || !email || !packageName) {
    return res.status(400).json({ ok: false, error: 'Eksik parametre' });
  }

  const PRICES = { 'VIP':60,'VIP+':80,'KVIP':120,'KVIP+':160,'GoldenVIP':200,'GoldenVIP+':240 };
  const price  = PRICES[packageName];
  if (!price) return res.status(400).json({ ok: false, error: 'Geçersiz paket' });

  const orderId    = `GMC-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const merchantId = CONFIG.PAYTR_MERCHANT_ID;
  const merchantKey= CONFIG.PAYTR_MERCHANT_KEY;
  const merchantSalt=CONFIG.PAYTR_MERCHANT_SALT;

  const basketItems = JSON.stringify([[packageName + ' Rank', price.toString(), 1]]);
  const basketEncoded = Buffer.from(basketItems).toString('base64');

  const hashStr = merchantId + userIp + orderId + username + email
                + (price * 100).toString() + basketEncoded + '0' + 'tr'
                + merchantSalt;
  const token = crypto.createHmac('sha256', merchantKey).update(hashStr).digest('base64');

  const params = new URLSearchParams({
    merchant_id       : merchantId,
    user_ip           : userIp || '127.0.0.1',
    merchant_oid      : orderId,
    email             : email,
    payment_amount    : (price * 100).toString(),
    paytr_token       : token,
    user_basket       : basketEncoded,
    debug_on          : '1',
    no_installment    : '0',
    max_installment   : '0',
    user_name         : username,
    user_address      : 'Türkiye',
    user_phone        : '05000000000',
    merchant_ok_url   : `https://${req.headers.host}/payment/success`,
    merchant_fail_url : `https://${req.headers.host}/payment/fail`,
    timeout_limit     : '30',
    currency          : 'TL',
    test_mode         : '1',
    lang              : 'tr',
  });

  try {
    const paytrRes = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : params.toString()
    });
    const paytrData = await paytrRes.json();
    if (paytrData.status === 'success') {
      // Siparişi kaydet
      pendingOrders[orderId] = { username, packageName, rank: packageName, email, price };
      res.json({ ok: true, token: paytrData.token, orderId });
    } else {
      res.json({ ok: false, error: paytrData.reason || 'PayTR hatası' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Bekleyen siparişler (production'da DB kullan)
const pendingOrders = {};

// ── POST /api/payment/callback ── PayTR callback (ödeme onayı)
app.post('/api/payment/callback', async (req, res) => {
  const { merchant_oid, status, total_amount, hash } = req.body;

  // Hash doğrula
  const checkHash = crypto
    .createHmac('sha256', CONFIG.PAYTR_MERCHANT_KEY)
    .update(merchant_oid + CONFIG.PAYTR_MERCHANT_SALT + status + total_amount)
    .digest('base64');

  if (hash !== checkHash) {
    return res.send('PAYTR_INVALID_HASH');
  }

  if (status === 'success') {
    const order = pendingOrders[merchant_oid];
    if (order) {
      try {
        const group = RANK_GROUPS[order.rank] || 'vip';
        await rconCommand(
          CONFIG.MC_HOST, CONFIG.MC_PORT, CONFIG.RCON_PASS,
          `lp user ${order.username} parent set ${group}`
        );
        console.log(`✅ Rank verildi: ${order.username} → ${order.rank}`);
        delete pendingOrders[merchant_oid];
      } catch (e) {
        console.error('RCON rank hatası:', e.message);
      }
    }
  }
  res.send('OK');
});

// ── POST /api/apply ── Başvuru kaydet
const applications = [];
app.post('/api/apply', (req, res) => {
  const { username, type, age, ...extra } = req.body;
  if (!username || !type) return res.status(400).json({ ok: false, error: 'Eksik alan' });
  if (parseInt(age) < 12) return res.status(400).json({ ok: false, error: '12 yaş şartı' });
  const app_entry = { id: Date.now(), username, type, age, status: 'Bekliyor', date: new Date().toISOString(), ...extra };
  applications.push(app_entry);
  res.json({ ok: true, id: app_entry.id });
});

// ── GET /api/applications ── Başvuruları listele (admin)
app.get('/api/applications', (req, res) => {
  const { adminPass } = req.query;
  if (adminPass !== CONFIG.ADMIN_PASS) return res.status(403).json({ ok: false });
  res.json({ ok: true, applications });
});

// ── POST /api/applications/:id ── Başvuru güncelle (admin)
app.post('/api/applications/:id', (req, res) => {
  const { adminPass, status } = req.body;
  if (adminPass !== CONFIG.ADMIN_PASS) return res.status(403).json({ ok: false });
  const entry = applications.find(a => a.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ ok: false });
  entry.status = status;
  res.json({ ok: true, entry });
});

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'GoldenMC Backend çalışıyor 🟢', version: '1.0.0' }));
app.get('/health', (req, res) => res.json({ ok: true }));

// ── BAŞLAT ──
app.listen(PORT, () => {
  console.log(`\n🟢 GoldenMC Backend başlatıldı`);
  console.log(`📡 Port     : ${PORT}`);
  console.log(`🎮 MC Host  : ${CONFIG.MC_HOST}`);
  console.log(`🔧 RCON Port: ${CONFIG.MC_PORT}\n`);
});