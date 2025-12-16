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

    # CRITICAL: Use dwFlags = 1 (all users) - this is what makes it work!
    $result = [WlanApi]::WlanSetProfileEapXmlUserData(
        $clientHandle,
        [ref]$interfaceGuid,
        $ProfileName,
        1,
        $eapXml,
        [IntPtr]::Zero
    )

    # Fallback: If dwFlags=1 fails, try dwFlags=0 (current user)
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
