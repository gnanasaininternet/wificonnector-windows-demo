const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");

// HELPERS
function ts(msg) {
  return `[${new Date().toLocaleTimeString()}] ${msg}`;
}

function stringToHex(str) {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function execP(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { shell: true, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout?.toString().trim() || "",
        stderr: stderr?.toString().trim() || "",
      });
    });
  });
}

async function checkAdminPrivileges() {
  const res = await execP('net session 2>&1');
  return res.success;
}

async function isNetworkInRange(ssid) {
  const res = await execP(`netsh wlan show networks`);
  return res.stdout.includes(ssid);
}

async function createUserAndConnect(payload, backendUrl) {
  const logs = [];
  const log = (msg) => logs.push(ts(msg));

  try {
    log("🚀 Starting WiFi Enterprise Connection Process...");

    const hasAdmin = await checkAdminPrivileges();
    if (!hasAdmin) {
      throw new Error("❌ Administrator privileges required. Please run as Administrator.");
    }
    log("✅ Running with Administrator privileges");

    log("📡 Calling backend API to create user...");
    const res = await axios.post(backendUrl, payload, { timeout: 10000 });
    
    if (res.data.status !== "success") {
      throw new Error(res.data.message || "Backend API failed");
    }

    const { wifi_username, wifi_password } = res.data;
    const ssid = "RadiusTest5G";
    const ssidHex = stringToHex(ssid);

    log(`✅ Credentials received for user: ${wifi_username}`);

    // Create WiFi Profile XML
    const profileXml = [
      '<?xml version="1.0"?>',
      '<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">',
      '\t<name>' + ssid + '</name>',
      '\t<SSIDConfig>',
      '\t\t<SSID>',
      '\t\t\t<hex>' + ssidHex + '</hex>',
      '\t\t\t<name>' + ssid + '</name>',
      '\t\t</SSID>',
      '\t\t<nonBroadcast>false</nonBroadcast>',
      '\t</SSIDConfig>',
      '\t<connectionType>ESS</connectionType>',
      '\t<connectionMode>auto</connectionMode>',
      '\t<autoSwitch>false</autoSwitch>',
      '\t<MSM>',
      '\t\t<security>',
      '\t\t\t<authEncryption>',
      '\t\t\t\t<authentication>WPA2</authentication>',
      '\t\t\t\t<encryption>AES</encryption>',
      '\t\t\t\t<useOneX>true</useOneX>',
      '\t\t\t</authEncryption>',
      '\t\t\t<PMKCacheMode>enabled</PMKCacheMode>',
      '\t\t\t<PMKCacheTTL>720</PMKCacheTTL>',
      '\t\t\t<PMKCacheSize>128</PMKCacheSize>',
      '\t\t\t<preAuthMode>disabled</preAuthMode>',
      '\t\t\t<OneX xmlns="http://www.microsoft.com/networking/OneX/v1">',
      '\t\t\t\t<cacheUserData>true</cacheUserData>',
      '\t\t\t\t<authMode>user</authMode>',
      '\t\t\t\t<EAPConfig>',
      '\t\t\t\t\t<EapHostConfig xmlns="http://www.microsoft.com/provisioning/EapHostConfig">',
      '\t\t\t\t\t\t<EapMethod>',
      '\t\t\t\t\t\t\t<Type xmlns="http://www.microsoft.com/provisioning/EapCommon">25</Type>',
      '\t\t\t\t\t\t\t<VendorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorId>',
      '\t\t\t\t\t\t\t<VendorType xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorType>',
      '\t\t\t\t\t\t\t<AuthorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</AuthorId>',
      '\t\t\t\t\t\t</EapMethod>',
      '\t\t\t\t\t\t<Config xmlns="http://www.microsoft.com/provisioning/EapHostConfig">',
      '\t\t\t\t\t\t\t<Eap xmlns="http://www.microsoft.com/provisioning/BaseEapConnectionPropertiesV1">',
      '\t\t\t\t\t\t\t\t<Type>25</Type>',
      '\t\t\t\t\t\t\t\t<EapType xmlns="http://www.microsoft.com/provisioning/MsPeapConnectionPropertiesV1">',
      '\t\t\t\t\t\t\t\t\t<ServerValidation>',
      '\t\t\t\t\t\t\t\t\t\t<DisableUserPromptForServerValidation>false</DisableUserPromptForServerValidation>',
      '\t\t\t\t\t\t\t\t\t\t<ServerNames></ServerNames>',
      '\t\t\t\t\t\t\t\t\t</ServerValidation>',
      '\t\t\t\t\t\t\t\t\t<FastReconnect>true</FastReconnect>',
      '\t\t\t\t\t\t\t\t\t<InnerEapOptional>false</InnerEapOptional>',
      '\t\t\t\t\t\t\t\t\t<Eap xmlns="http://www.microsoft.com/provisioning/BaseEapConnectionPropertiesV1">',
      '\t\t\t\t\t\t\t\t\t\t<Type>26</Type>',
      '\t\t\t\t\t\t\t\t\t\t<EapType xmlns="http://www.microsoft.com/provisioning/MsChapV2ConnectionPropertiesV1">',
      '\t\t\t\t\t\t\t\t\t\t\t<UseWinLogonCredentials>false</UseWinLogonCredentials>',
      '\t\t\t\t\t\t\t\t\t\t</EapType>',
      '\t\t\t\t\t\t\t\t\t</Eap>',
      '\t\t\t\t\t\t\t\t\t<EnableQuarantineChecks>false</EnableQuarantineChecks>',
      '\t\t\t\t\t\t\t\t\t<RequireCryptoBinding>false</RequireCryptoBinding>',
      '\t\t\t\t\t\t\t\t\t<PeapExtensions>',
      '\t\t\t\t\t\t\t\t\t\t<PerformServerValidation xmlns="http://www.microsoft.com/provisioning/MsPeapConnectionPropertiesV2">false</PerformServerValidation>',
      '\t\t\t\t\t\t\t\t\t\t<AcceptServerName xmlns="http://www.microsoft.com/provisioning/MsPeapConnectionPropertiesV2">false</AcceptServerName>',
      '\t\t\t\t\t\t\t\t\t</PeapExtensions>',
      '\t\t\t\t\t\t\t\t</EapType>',
      '\t\t\t\t\t\t\t</Eap>',
      '\t\t\t\t\t\t</Config>',
      '\t\t\t\t\t</EapHostConfig>',
      '\t\t\t\t</EAPConfig>',
      '\t\t\t</OneX>',
      '\t\t</security>',
      '\t</MSM>',
      '</WLANProfile>'
    ].join('\r\n');

    const profilePath = path.join(app.getPath("userData"), "wifi_profile.xml");
    fs.writeFileSync(profilePath, profileXml, { encoding: 'utf8' });

    log("✅ WiFi profile XML generated");

   log(`🗑️ Removing old profile for ${ssid} (if exists)...`);
await execP(`netsh wlan delete profile name="${ssid}"`);

log(`📥 Installing WiFi profile for ${ssid}...`);
// Changed: Removed user=current to match PowerShell dwFlags=1 (all users)
const addRes = await execP(`netsh wlan add profile filename="${profilePath}"`);

if (!addRes.success) {
  const errorMsg = addRes.stderr || addRes.stdout;
  throw new Error(`Profile installation failed: ${errorMsg}`);
}

log("✅ WiFi Profile Installed Successfully");


    // CRITICAL: Store credentials using PowerShell with Base64 encoding
    log(`🔐 Storing credentials in Windows vault...`);
    
    const psScriptPath = path.join(__dirname, 'setWifiCredentials.ps1');

    // Encode credentials to Base64 to safely pass special characters
    const usernameBase64 = Buffer.from(wifi_username).toString('base64');
    const passwordBase64 = Buffer.from(wifi_password).toString('base64');

    const psCommand = `powershell -ExecutionPolicy Bypass -NoProfile -File "${psScriptPath}" -ProfileName "${ssid}" -EncodedUsername "${usernameBase64}" -EncodedCredential "${passwordBase64}"`;
    
    log(`🔍 Executing credential storage...`);
    const credResult = await execP(psCommand);
    
    log(`🔍 PowerShell response: ${credResult.stdout || credResult.stderr}`);
    
    if (credResult.stdout.includes('SUCCESS')) {
      log("✅ Credentials stored successfully in Windows!");
      log("🎉 Zero-touch auto-connect enabled!");
    } else if (credResult.stdout.includes('ERROR')) {
      const errorMatch = credResult.stdout.match(/ERROR:(.+)/);
      const errorMsg = errorMatch ? errorMatch[1] : credResult.stdout;
      log(`❌ Credential storage failed: ${errorMsg}`);
      log("📋 Fallback: Credentials will be shown for manual entry");
    } else {
      log(`⚠️ Unexpected response from PowerShell`);
      log(`   Output: ${credResult.stdout || 'none'}`);
      log(`   Error: ${credResult.stderr || 'none'}`);
    }

    // Verify credentials were stored
    await new Promise((r) => setTimeout(r, 1500));
    const verifyRes = await execP(`netsh wlan show profile name="${ssid}"`);
    const credentialsConfigured = verifyRes.stdout.includes('Credentials configured : Yes');
    
    if (credentialsConfigured) {
      log("✅ VERIFIED: Windows has credentials saved!");
    } else {
      log("⚠️ WARNING: Credentials verification shows not saved");
      log("   This may require manual entry on first connection");
    }

    log("");
    log("═══════════════════════════════════════════════");
    log("📋 CONFIGURATION SUMMARY");
    log("═══════════════════════════════════════════════");
    log(`Network: ${ssid}`);
    log(`Username: ${wifi_username}`);
    log(`Password: ${wifi_password}`);
    log(`Profile: Installed ✅`);
    log(`Credentials: ${credentialsConfigured ? 'Stored ✅' : 'Not Stored ❌'}`);
    log("═══════════════════════════════════════════════");
    log("");

    log(`🔍 Scanning for ${ssid} network...`);
    const inRange = await isNetworkInRange(ssid);

    if (!inRange) {
      log(`⚠️ Network "${ssid}" not detected in range`);
      log("");
      if (credentialsConfigured) {
        log("✅ Everything ready! When you move near RadiusTest5G:");
        log("   • Windows will auto-connect automatically");
        log("   • No prompts or user interaction needed");
        log("   • Just like regular WiFi!");
      } else {
        log("📍 When you move near RadiusTest5G:");
        log("   1. Windows will show connection prompt");
        log("   2. Enter username and password shown above");
        log("   3. Check 'Remember my credentials'");
        log("   4. Future connections will be automatic");
      }
      
      return { 
        ok: true, 
        profileInstalled: true, 
        credentialsStored: credentialsConfigured,
        connected: false,
        inRange: false,
        credentials: { username: wifi_username, password: wifi_password },
        logs 
      };
    }

    log(`✅ Network "${ssid}" detected in range!`);
    log(`🔌 Attempting to connect...`);
    
    const connRes = await execP(`netsh wlan connect name="${ssid}" ssid="${ssid}"`);
    
    if (!connRes.success) {
      log(`⚠️ Connection command failed: ${connRes.stderr || connRes.stdout}`);
    } else {
      log("✅ Connection initiated");
    }

    // Wait and verify connection
    await new Promise((r) => setTimeout(r, 5000));
    
    const statusRes = await execP(`netsh wlan show interfaces`);
    const isConnected = statusRes.stdout.includes(ssid) && statusRes.stdout.includes('connected');
    
    if (isConnected) {
      log("");
      log("🎉🎉🎉 SUCCESS! CONNECTED TO WIFI! 🎉🎉🎉");
      log("✅ Auto-connect enabled for future connections");
      log("✅ No user prompts will be needed");
      
      return { 
        ok: true, 
        profileInstalled: true, 
        credentialsStored: credentialsConfigured,
        connected: true,
        inRange: true,
        logs 
      };
    } else {
      log("");
      log("⏳ Connection in progress...");
      if (credentialsConfigured) {
        log("✅ Credentials stored - should connect automatically");
      } else {
        log("⚠️ May prompt for credentials - use details shown above");
      }
      
      return { 
        ok: true, 
        profileInstalled: true, 
        credentialsStored: credentialsConfigured,
        connected: false,
        inRange: true,
        credentials: { username: wifi_username, password: wifi_password },
        logs 
      };
    }

  } catch (err) {
    logs.push(ts("🔥 ERROR: " + err.message));
    return { ok: false, profileInstalled: false, connected: false, logs };
  }
}

module.exports = { createUserAndConnect };
