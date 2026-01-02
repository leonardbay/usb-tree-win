import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { USBDevice, getDeviceName } from './usb-common';

/**
 * Run PowerShell script and get USB tree data using pnputil
 * This is the fast path implementation ported from v1.0.1
 */
export function getUSBTreeDataPnputil(): {
    devices: Map<string, USBDevice>;
    comPorts: Map<string, { instancePath: string; kernelName: string; channel?: number }>;
} {
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'

# Get ONLY currently connected/started USB devices using pnputil
# We need multiple classes: USB (hubs, standard devices), USBDevice (WinUSB devices), Ports (COM ports)
$connectedDevices = @{}

foreach ($class in @("USB", "USBDevice", "Ports")) {
    $pnpOutput = pnputil /enum-devices /class $class /connected 2>$null
    foreach ($line in $pnpOutput -split "\`n") {
        if ($line -match "Instance ID:\\s*(.+)") {
            $currentDevice = $matches[1].Trim()
            $connectedDevices[$currentDevice] = $true
        }
    }
}

# Now enumerate USB devices from registry, but only output connected ones
$usbPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB"

Get-ChildItem $usbPath | ForEach-Object {
    $vidPidKey = $_.PSChildName
    Get-ChildItem $_.PSPath | ForEach-Object {
        $instanceId = $_.PSChildName
        $fullPath = $_.PSPath
        $props = Get-ItemProperty $fullPath
        
        $instancePath = "USB\\$vidPidKey\\$instanceId"
        
        # Skip if not currently connected
        if (-not $connectedDevices[$instancePath]) { return }
        
        # Skip interface devices (MI_xx)
        if ($vidPidKey -match "&MI_\\d+") { return }
        
        # Get parent via pnputil
        $parentPath = ""
        $pnpDevOutput = pnputil /enum-devices /instanceid "$instancePath" /relations 2>$null
        $parentLine = ($pnpDevOutput | Select-String "Parent:" | Select-Object -First 1)
        if ($parentLine) {
            $parentPath = ($parentLine -replace "^\\s*Parent:\\s*", "").Trim()
        }
        
        # Extract port number from location info (e.g., "Port_#0001.Hub_#0002")
        $portNumber = 0
        if ($props.LocationInformation -match "Port_#(\\d+)") {
            $portNumber = [int]$matches[1]
        }
        
        # Parse VID/PID
        $vidVal = ""
        $pidVal = ""
        if ($vidPidKey -match "VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})") {
            $vidVal = $matches[1]
            $pidVal = $matches[2]
        } elseif ($vidPidKey -eq "ROOT_HUB30") {
            $vidVal = "ROOT"
            $pidVal = "HUB30"
        }
        
        $isHub = ($props.Service -eq "USBHUB" -or $props.Service -eq "USBHUB3" -or $props.Service -eq "usbhub" -or $props.Service -eq "usbhub3" -or $vidPidKey -eq "ROOT_HUB30")
        
        $name = if ($props.FriendlyName) { $props.FriendlyName } elseif ($props.DeviceDesc) { $props.DeviceDesc } else { $vidPidKey }
        
        Write-Output "DEVICE|$instancePath|$vidVal|$pidVal|$instanceId|$parentPath|$portNumber|$isHub|$name"
    }
}

# Get COM ports directly from pnputil output - most reliable method
# First, get PDO names (Kernel Names) using /properties (bulk operation)
$pdoMap = @{}
$pnpProps = pnputil /enum-devices /class Ports /connected /properties 2>$null
$currentId = $null
$capturePdo = $false

foreach ($line in $pnpProps -split "\`n") {
    if ($line -match "Instance ID:\\s*(.+)") {
        $currentId = $matches[1].Trim()
        $capturePdo = $false
    }
    elseif ($line -match "DEVPKEY_Device_PDOName") {
        $capturePdo = $true
    }
    elseif ($capturePdo -and $currentId -and $line.Trim().Length -gt 0) {
        $pdoMap[$currentId] = $line.Trim()
        $capturePdo = $false
    }
}

$comPortOutput = pnputil /enum-devices /class Ports /connected 2>$null
$currentInstanceId = $null
$currentDescription = $null

foreach ($line in $comPortOutput -split "\`n") {
    if ($line -match "Instance ID:\\s*(.+)") {
        $currentInstanceId = $matches[1].Trim()
    }
    elseif ($line -match "Device Description:\\s*(.+)") {
        $currentDescription = $matches[1].Trim()
        
        # Extract COM port from description like "Silicon Labs CP210x USB to UART Bridge (COM9)"
        if ($currentDescription -match "\\(COM(\\d+)\\)") {
            $comPort = "COM$($matches[1])"
            $kernelName = if ($pdoMap[$currentInstanceId]) { $pdoMap[$currentInstanceId] } else { "" }
            
            # Determine if this is FTDI or regular USB COM port
            if ($currentInstanceId -match "^FTDIBUS\\\\") {
                # FTDI: FTDIBUS\\VID_0403+PID_6010+...\\0000
                $channel = 0
                $parentDeviceId = ""
                if ($currentInstanceId -match "VID_([0-9A-Fa-f]+)\\+PID_([0-9A-Fa-f]+)\\+(.+?)\\\\") {
                    $parentDeviceId = $matches[3]
                    # Channel is the last part: 7&b5542c6&0&2&1 -> channel 1
                    if ($parentDeviceId -match "&(\\d+)$") {
                        $channel = [int]$matches[1]
                        $parentDeviceId = $parentDeviceId -replace "&\\d+$", ""
                    }
                }
                $parentUsbPath = "USB\\VID_0403&PID_6010\\$parentDeviceId"
                Write-Output "COMPORT|$comPort|$parentUsbPath|$channel|$kernelName"
            }
            elseif ($currentInstanceId -match "^USB\\\\") {
                # Regular USB: USB\\VID_10C4&PID_EA60\\xxxx
                Write-Output "COMPORT|$comPort|$currentInstanceId|0|$kernelName"
            }
        }
    }
}
`;

    const tmpFile = join(tmpdir(), `usb-tree-${Date.now()}.ps1`);
    writeFileSync(tmpFile, psScript);

    try {
        const output = execSync(
            `powershell -ExecutionPolicy Bypass -File "${tmpFile}"`,
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        const devices = new Map<string, USBDevice>();
        const comPorts = new Map<string, { instancePath: string; kernelName: string; channel?: number }>();

        for (const line of output.split('\n')) {
            const trimmed = line.trim();

            if (trimmed.startsWith('DEVICE|')) {
                const parts = trimmed.split('|');
                if (parts.length >= 9) {
                    const [, instancePath, vid, pid, instanceId, parentPath, portNum, isHubStr, ...nameParts] = parts;
                    const name = nameParts.join('|');

                    // Check if instance ID looks like a real serial (no & characters, reasonable length)
                    const looksLikeSerial = !instanceId.includes('&') && instanceId.length >= 4 && instanceId.length <= 32;

                    devices.set(instancePath.toUpperCase(), {
                        instancePath,
                        vid: vid.toUpperCase(),
                        pid: pid.toUpperCase(),
                        serialNumber: looksLikeSerial ? instanceId : '',
                        instanceId,
                        parentPath: parentPath && !parentPath.startsWith('PCI\\') ? parentPath : null,
                        portNumber: parseInt(portNum) || 0,
                        isHub: isHubStr === 'True',
                        name: getDeviceName(vid, pid, name),
                        comPorts: [],
                        children: [],
                        portChain: '',
                        kernelName: '',
                    });
                }
            } else if (trimmed.startsWith('COMPORT|')) {
                const parts = trimmed.split('|');
                if (parts.length >= 5) {
                    const [, comPort, instancePath, channelStr, kernelName] = parts;
                    const channel = parseInt(channelStr) || 0;
                    comPorts.set(comPort, {
                        instancePath,
                        kernelName: kernelName || '',
                        channel: channel > 0 ? channel : undefined,
                    });
                }
            }
        }

        unlinkSync(tmpFile);
        return { devices, comPorts };
    } catch (error) {
        try { unlinkSync(tmpFile); } catch { }
        throw error;
    }
}
