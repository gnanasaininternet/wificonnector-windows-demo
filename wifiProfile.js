const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");

function ts(msg) {
  return `[${new Date().toLocaleTimeString()}] ${msg}`;
}

function findTemplate() {
  const candidates = [
    path.join(process.resourcesPath, "wifi_profile.xml"),
    path.join(__dirname, "wifi_profile.xml"),
    path.join(process.resourcesPath, "app.asar.unpacked", "wifi_profile.xml"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("wifi_profile.xml NOT FOUND. Ensure it is in the project root.");
}

// Improved exec to capture output safely
function execDetailed(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { shell: true }, (error, stdout, stderr) => {
      resolve({ 
        success: !error, 
        code: error ? error.code : 0,
        stdout: stdout ? stdout.toString() : "", 
        stderr: stderr ? stderr.toString() : ""
      });
    });
  });
}

// NEW FUNCTION: Check if SSID is visible
async function isNetworkInRange(ssid) {
  const res = await execDetailed('netsh wlan show networks');
  if (!res.success) return false;
  // Check if our SSID exists in the output
  return res.stdout.includes(ssid);
}

async function createUserAndConnect(payload, backendUrl) {
  const logs = [];
  try {
    logs.push(ts("Starting process..."));
    
    // 1. Backend Call
    logs.push(ts("Calling backend..."));
    const res = await axios.post(backendUrl, payload);
    const data = res.data;

    if (data.status !== "success") {
       throw new Error("Backend error: " + (data.message || "Unknown error"));
    }

    const ssid = "RadiusTest5G";
    const username = data.wifi_username;
    const password = data.wifi_password;

    logs.push(ts(`Backend success. Username: ${username}`));

    // 2. CHECK IF IN ZONE (The Step You Asked For)
    logs.push(ts(`Scanning for WiFi network '${ssid}'...`));
    
    const inRange = await isNetworkInRange(ssid);

    if (!inRange) {
        // STOP HERE if not found
        logs.push(ts("❌ OUT OF ZONE: The network '" + ssid + "' is NOT visible."));
        logs.push(ts("Windows cannot install the Enterprise profile unless the WiFi is nearby."));
        logs.push(ts("Please run this app inside the office range."));
        return { ok: false, logs }; 
    }

    logs.push(ts("✅ Network found! Proceeding to install profile..."));

    // 3. Prepare XML
    const templatePath = findTemplate();
    let xml = fs.readFileSync(templatePath, "utf8");
    xml = xml.replace(/{{USERNAME}}/g, username);
    xml = xml.replace(/{{PASSWORD}}/g, password);
    xml = xml.replace(/{{SSID}}/g, ssid);

    const userDataPath = app.getPath("userData");
    const outFile = path.join(userDataPath, "wifi_profile_generated.xml");
    fs.writeFileSync(outFile, xml, "utf8");
    
    // 4. Delete Old & Add New
    await execDetailed(`netsh wlan delete profile name="${ssid}"`);
    
    logs.push(ts("Adding profile to Windows..."));
    const addRes = await execDetailed(`netsh wlan add profile filename="${outFile}" user=current`);

    if (!addRes.success) {
        logs.push(ts("CMD ERROR: " + addRes.stderr)); // Show exact Windows error
        throw new Error("Failed to add profile. See error above.");
    }

    // 5. Connect
    logs.push(ts("Connecting..."));
    const connRes = await execDetailed(`netsh wlan connect name="${ssid}" ssid="${ssid}"`);
    
    if (!connRes.success) {
        logs.push(ts("Connect failed: " + connRes.stderr));
    } else {
        logs.push(ts("✅ CONNECT COMMAND SENT SUCCESSFULLY!"));
    }

    return { ok: true, logs };

  } catch (e) {
    logs.push(ts("CRITICAL ERROR: " + e.message));
    return { ok: false, logs };
  }
}

module.exports = { createUserAndConnect };