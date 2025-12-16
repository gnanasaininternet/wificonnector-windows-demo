const logBox = document.getElementById("logs");
const submitBtn = document.getElementById("submitBtn");

function appendLog(msg) {
  logBox.value += msg + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

submitBtn.addEventListener("click", async () => {
  logBox.value = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "⏳ Processing...";

  const firstName = document.getElementById("first_name").value.trim();
  const lastName = document.getElementById("last_name").value.trim();
  const mobile = document.getElementById("mobile").value.trim();

  if (!firstName || !lastName || !mobile) {
    appendLog("❌ ERROR: All fields are required");
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 Create User & Connect WiFi";
    return;
  }

  if (mobile.length < 10) {
    appendLog("❌ ERROR: Please enter a valid 10-digit mobile number");
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 Create User & Connect WiFi";
    return;
  }

  const payload = {
    account_id: 6,
    first_name: firstName,
    last_name: lastName,
    mobile: mobile,
  };

  appendLog("→ Sending create_user request to backend...");
  appendLog("");

  try {
    const result = await window.wifiAPI.createAndConnect(payload);

    result.logs.forEach((ln) => appendLog(ln));

    if (!result.ok) {
      appendLog("");
      appendLog("❌ PROCESS FAILED — Check error messages above");
      appendLog("💡 Make sure you're running the app as Administrator");
    } 
    else if (result.connected) {
      appendLog("");
      appendLog("╔═══════════════════════════════════════════════╗");
      appendLog("║     🎉 SUCCESS - CONNECTED TO WIFI! 🎉        ║");
      appendLog("╚═══════════════════════════════════════════════╝");
      appendLog("");
      appendLog(`✅ User: ${firstName} ${lastName}`);
      appendLog(`✅ Mobile: ${mobile}`);
      appendLog(`✅ Network: RadiusTest5G`);
      appendLog(`✅ Credentials: Stored securely in Windows`);
      appendLog("");
      appendLog("🌟 FUTURE CONNECTIONS:");
      appendLog("   • Fully automatic - no prompts");
      appendLog("   • Works after laptop restart");
      appendLog("   • Connects when in range");
      appendLog("   • Zero user interaction needed!");
    } 
    else if (result.profileInstalled) {
      appendLog("");
      if (result.credentialsStored) {
        appendLog("╔═══════════════════════════════════════════════╗");
        appendLog("║   ✅ ZERO-TOUCH SETUP COMPLETE! ✅            ║");
        appendLog("╚═══════════════════════════════════════════════╝");
        appendLog("");
        appendLog("✅ WiFi profile installed");
        appendLog("✅ Credentials stored in Windows vault");
        appendLog("✅ Auto-connect enabled");
        appendLog("");
        if (!result.inRange) {
          appendLog("📡 Network not in range currently");
          appendLog("");
          appendLog("🌟 WHEN YOU MOVE NEAR RadiusTest5G:");
          appendLog("   • Windows will connect AUTOMATICALLY");
          appendLog("   • NO prompts or user input needed");
          appendLog("   • Works exactly like home WiFi");
          appendLog("   • Just turn on WiFi and go!");
        }
      } else {
        appendLog("╔═══════════════════════════════════════════════╗");
        appendLog("║   ✅ PROFILE INSTALLED - ONE-TIME SETUP      ║");
        appendLog("╚═══════════════════════════════════════════════╝");
        appendLog("");
        appendLog("⚠️ Credentials need one-time manual entry");
        appendLog("");
        appendLog("📝 SAVE THESE CREDENTIALS:");
        appendLog(`   Username: ${result.credentials.username}`);
        appendLog(`   Password: ${result.credentials.password}`);
        appendLog("");
        appendLog("📍 SETUP STEPS:");
        appendLog("   1. Move near RadiusTest5G access point");
        appendLog("   2. Windows will prompt for credentials");
        appendLog("   3. Enter username and password above");
        appendLog("   4. ✅ CHECK 'Remember my credentials'");
        appendLog("   5. Click Connect");
        appendLog("");
        appendLog("🌟 AFTER FIRST CONNECT:");
        appendLog("   • Auto-connect works forever");
        appendLog("   • No more prompts needed");
        appendLog("   • Works like regular WiFi");
      }
    }
  } catch (error) {
    appendLog("");
    appendLog("🔥 CRITICAL ERROR: " + error.message);
    appendLog("💡 Make sure you're running the app as Administrator");
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "🚀 Create User & Connect WiFi";
});
