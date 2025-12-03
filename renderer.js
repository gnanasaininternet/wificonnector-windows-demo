const logBox = document.getElementById("logs");

function appendLog(msg) {
  logBox.value += msg + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

document.getElementById("submitBtn").addEventListener("click", async () => {
  logBox.value = "";

  const firstName = document.getElementById("first_name").value.trim();
  const lastName = document.getElementById("last_name").value.trim();
  const mobile = document.getElementById("mobile").value.trim();

  const payload = {
    account_id: 6,
    first_name: firstName,
    last_name: lastName,
    mobile: mobile,
  };

  appendLog("→ Sending create_user request...");

  const result = await window.wifiAPI.createAndConnect(payload);

  result.logs.forEach((ln) => appendLog(ln));

  if (!result.ok) {
    appendLog("❌ FAILED — Check above logs");
  } else {
    appendLog("✅ SUCCESS — WiFi profile installed. Windows will auto-connect.");
  }
});
