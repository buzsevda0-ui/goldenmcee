function startPayment(){
  const username=document.getElementById('payUsername').value.trim();
  const email=document.getElementById('payEmail').value.trim();

  if(!username){
    showToast('⚠ Kullanıcı adı gir');
    return;
  }

  if(!email || !email.includes('@')){
    showToast('⚠ Geçerli e-posta gir');
    return;
  }

  // SENİN PAYCELL / IBAN / DC
  const mesaj = `
VIP Satın Alma Talebi

Kullanıcı: ${username}
E-posta: ${email}
Paket: ${currentRank}
Fiyat: ${currentPrice}₺
  `;

  // Discord webhook (önerilir)
  fetch("BURAYA_DISCORD_WEBHOOK", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({content: mesaj})
  });

  showToast("✓ Talep gönderildi! Ödeme için Discord / Paycell ile iletişime geç");

  document.getElementById('modalOverlay').classList.remove('open');
}
