const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");
const os = require("os");

// Embed PowerShell script as a string (to avoid ASAR issues)
const POWERSHELL_SCRIPT = `
param(
    [Parameter(Mandatory=$true)]
    [string]$ProfileName,
    
    [Parameter(Mandatory=$true)]
    [string]$EncodedUsername,
    
    [Parameter(Mandatory=$true)]
    [string]$EncodedCredential
)

# Decode Base64 credentials
try {
    $Username = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedUsername))
    $Password = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedCredential))
} catch {
    Write-Output "ERROR:Failed to decode credentials: $($_.Exception.Message)"
    exit 1
}

# Function to convert special XML characters
function ConvertTo-XmlSafe {
    param([string]$InputText)
    if ([string]::IsNullOrEmpty($InputText)) {
        return ""
    }
    $InputText = $InputText -replace '&', '&amp;'
    $InputText = $InputText -replace '<', '&lt;'
    $InputText = $InputText -replace '>', '&gt;'
    $InputText = $InputText -replace '"', '&quot;'
    $InputText = $InputText -replace "'", '&apos;'
    return $InputText
}

$SafeUsername = ConvertTo-XmlSafe -InputText $Username
$SafePassword = ConvertTo-XmlSafe -InputText $Password

# Define WLAN API
$WlanApiCode = @"
using System;
using System.Runtime.InteropServices;

public class WlanApi {
    [DllImport("wlanapi.dll", SetLastError = true)]
    public static extern uint WlanOpenHandle(
        uint dwClientVersion,
        IntPtr pReserved,
        out uint pdwNegotiatedVersion,
        out IntPtr phClientHandle
    );

    [DllImport("wlanapi.dll", SetLastError = true)]
    public static extern uint WlanCloseHandle(
        IntPtr hClientHandle,
        IntPtr pReserved
    );

    [DllImport("wlanapi.dll", SetLastError = true)]
    public static extern uint WlanEnumInterfaces(
        IntPtr hClientHandle,
        IntPtr pReserved,
        out IntPtr ppInterfaceList
    );

    [DllImport("wlanapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern uint WlanSetProfileEapXmlUserData(
        IntPtr hClientHandle,
        ref Guid pInterfaceGuid,
        string strProfileName,
        uint dwFlags,
        string strEapXmlUserData,
        IntPtr pReserved
    );

    [DllImport("wlanapi.dll", SetLastError = true)]
    public static extern void WlanFreeMemory(IntPtr pMemory);
}
"@

try {
    Add-Type -TypeDefinition $WlanApiCode -ErrorAction SilentlyContinue
} catch {}

# Create EAP XML
$eapXml = @"
<?xml version="1.0"?>
<EapHostUserCredentials xmlns="http://www.microsoft.com/provisioning/EapHostUserCredentials" xmlns:eapCommon="http://www.microsoft.com/provisioning/EapCommon" xmlns:baseEap="http://www.microsoft.com/provisioning/BaseEapMethodUserCredentials">
    <EapMethod>
        <eapCommon:Type>25</eapCommon:Type>
        <eapCommon:AuthorId>0</eapCommon:AuthorId>
    </EapMethod>
    <Credentials xmlns:eapUser="http://www.microsoft.com/provisioning/EapUserPropertiesV1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:baseEap="http://www.microsoft.com/provisioning/BaseEapUserPropertiesV1" xmlns:MsPeap="http://www.microsoft.com/provisioning/MsPeapUserPropertiesV1" xmlns:MsChapV2="http://www.microsoft.com/provisioning/MsChapV2UserPropertiesV1">
        <baseEap:Eap>
            <baseEap:Type>25</baseEap:Type>
            <MsPeap:EapType>
                <MsPeap:RoutingIdentity>$SafeUsername</MsPeap:RoutingIdentity>
                <baseEap:Eap>
                    <baseEap:Type>26</baseEap:Type>
                    <MsChapV2:EapType>
                        <MsChapV2:Username>$SafeUsername</MsChapV2:Username>
                        <MsChapV2:Password>$SafePassword</MsChapV2:Password>
                        <MsChapV2:LogonDomain></MsChapV2:LogonDomain>
                    </MsChapV2:EapType>
                </baseEap:Eap>
            </MsPeap:EapType>
        </baseEap:Eap>
    </Credentials>
</EapHostUserCredentials>
"@

try {
    $negotiatedVersion = 0
    $clientHandle = [IntPtr]::Zero
    $result = [WlanApi]::WlanOpenHandle(2, [IntPtr]::Zero, [ref]$negotiatedVersion, [ref]$clientHandle)
    
    if ($result -ne 0) {
        Write-Output "ERROR:WlanOpenHandle failed: $result"
        exit 1
    }

    $interfaceListPtr = [IntPtr]::Zero
    $result = [WlanApi]::WlanEnumInterfaces($clientHandle, [IntPtr]::Zero, [ref]$interfaceListPtr)
    
    if ($result -ne 0) {
        [WlanApi]::WlanCloseHandle($clientHandle, [IntPtr]::Zero) | Out-Null
        Write-Output "ERROR:WlanEnumInterfaces failed: $result"
        exit 1
    }

    $numInterfaces = [System.Runtime.InteropServices.Marshal]::ReadInt32($interfaceListPtr, 0)
    
    if ($numInterfaces -eq 0) {
        [WlanApi]::WlanFreeMemory($interfaceListPtr)
        [WlanApi]::WlanCloseHandle($clientHandle, [IntPtr]::Zero) | Out-Null
        Write-Output "ERROR:No WiFi interfaces found"
        exit 1
    }

    $guidBytes = New-Object byte[] 16
    [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($interfaceListPtr, 8), $guidBytes, 0, 16)
    $interfaceGuid = New-Object Guid(,$guidBytes)

    $result = [WlanApi]::WlanSetProfileEapXmlUserData(
        $clientHandle,
        [ref]$interfaceGuid,
        $ProfileName,
        1,
        $eapXml,
        [IntPtr]::Zero
    )

    if ($result -ne 0) {
        $result = [WlanApi]::WlanSetProfileEapXmlUserData(
            $clientHandle,
            [ref]$interfaceGuid,
            $ProfileName,
            0,
            $eapXml,
            [IntPtr]::Zero
        )
    }

    [WlanApi]::WlanFreeMemory($interfaceListPtr)
    [WlanApi]::WlanCloseHandle($clientHandle, [IntPtr]::Zero) | Out-Null

    if ($result -eq 0) {
        Write-Output "SUCCESS:Credentials stored successfully"
        exit 0
    } else {
        Write-Output "ERROR:WlanSetProfileEapXmlUserData failed: $result"
        exit 1
    }
}
catch {
    Write-Output "ERROR:Exception: $($_.Exception.Message)"
    exit 1
}
`;

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
    const addRes = await execP(`netsh wlan add profile filename="${profilePath}"`);
    
    if (!addRes.success) {
      const errorMsg = addRes.stderr || addRes.stdout;
      throw new Error(`Profile installation failed: ${errorMsg}`);
    }
    
    log("✅ WiFi Profile Installed Successfully");

    // CRITICAL: Store credentials using PowerShell
    log(`🔐 Storing credentials in Windows vault...`);
    
    // Write PowerShell script to temp file (to avoid ASAR issues)
    const tempDir = os.tmpdir();
    const psScriptPath = path.join(tempDir, `setWifiCreds_${Date.now()}.ps1`);
    fs.writeFileSync(psScriptPath, POWERSHELL_SCRIPT, { encoding: 'utf8' });

    // Encode credentials to Base64
    const usernameBase64 = Buffer.from(wifi_username).toString('base64');
    const passwordBase64 = Buffer.from(wifi_password).toString('base64');

    const psCommand = `powershell -ExecutionPolicy Bypass -NoProfile -File "${psScriptPath}" -ProfileName "${ssid}" -EncodedUsername "${usernameBase64}" -EncodedCredential "${passwordBase64}"`;
    
    log(`🔍 Executing credential storage...`);
    const credResult = await execP(psCommand);
    
    // Clean up temp PowerShell file
    try {
      fs.unlinkSync(psScriptPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
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
