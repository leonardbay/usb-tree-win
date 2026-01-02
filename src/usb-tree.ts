/**
 * USB Tree Enumerator - Windows Registry Based
 * Builds actual USB topology from Windows registry parent-child relationships
 * Only enumerates currently connected devices
 * Uses pnputil (fast) with fallback to native PowerShell CIM/WMI calls
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { USBDevice, ComPortInfo, USBTree, getDeviceName } from './usb-common';
import { getUSBTreeDataPnputil } from './usb-tree-pnputil';

// Re-export common types for consumers (like index.ts)
export * from './usb-common';

/**
 * Run PowerShell script and get USB tree data - ONLY CONNECTED DEVICES
 * (Fallback method using native CIM/WMI)
 */
function getUSBTreeDataPowerShell(): {
    devices: Map<string, USBDevice>;
    comPorts: Map<string, { instancePath: string; kernelName: string; channel?: number }>;
} {
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'

# 1. Get all connected PnP entities once (fastest method)
$allDevices = Get-CimInstance -ClassName Win32_PnPEntity -Filter "Status='OK'"

# 2. Build lookup tables and lists in memory
$connectedDevices = @{}
$portsDevices = @()
$usbInstanceIds = @()

foreach ($dev in $allDevices) {
    if ($dev.PNPClass -eq 'USB' -or $dev.PNPClass -eq 'USBDevice' -or $dev.PNPClass -eq 'Ports') {
        $id = $dev.PNPDeviceID
        $connectedDevices[$id.ToUpper()] = $true
        $usbInstanceIds += $id
        
        if ($dev.PNPClass -eq 'Ports') {
            $portsDevices += $dev
        }
    }
}

# 3. Bulk fetch parent relationships (batch operation)
$parentMap = @{}
if ($usbInstanceIds.Count -gt 0) {
    # Get-PnpDeviceProperty accepts array of InstanceIds
    # We batch them in chunks to avoid failures with large sets or specific bad IDs
    for ($i = 0; $i -lt $usbInstanceIds.Count; $i += 20) {
        $count = [Math]::Min(20, $usbInstanceIds.Count - $i)
        $batch = $usbInstanceIds[$i..($i+$count-1)]
        
        try {
            $props = Get-PnpDeviceProperty -InstanceId $batch -KeyName 'DEVPKEY_Device_Parent' -ErrorAction Stop
            foreach ($p in $props) {
                if ($p.Data) {
                    $parentMap[$p.InstanceId.ToUpper()] = $p.Data
                }
            }
        } catch {
            # Fallback to individual fetch if batch fails
            foreach ($id in $batch) {
                try {
                    $p = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue
                    if ($p.Data) {
                        $parentMap[$id.ToUpper()] = $p.Data
                    }
                } catch {}
            }
        }
    }
}

# 4. Enumerate Registry for structure (fast)
$usbPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB"

Get-ChildItem $usbPath | ForEach-Object {
    $vidPidKey = $_.PSChildName
    Get-ChildItem $_.PSPath | ForEach-Object {
        $instanceId = $_.PSChildName
        $fullPath = $_.PSPath
        $props = Get-ItemProperty $fullPath
        
        $instancePath = "USB\\$vidPidKey\\$instanceId"
        
        # Skip if not currently connected
        if (-not $connectedDevices[$instancePath.ToUpper()]) { return }
        
        # Skip interface devices (MI_xx)
        if ($vidPidKey -match "&MI_\\d+") { return }
        
        # Get parent from pre-fetched map
        $parentPath = $parentMap[$instancePath.ToUpper()]
        
        # Safety net: If parent missing from batch, try individual fetch
        if (-not $parentPath) {
            try {
                $p = Get-PnpDeviceProperty -InstanceId $instancePath -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue
                if ($p.Data) {
                    $parentPath = $p.Data
                }
            } catch {}
        }

        if (-not $parentPath) { $parentPath = "" }
        
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

# 5. Output COM ports from cached list (fast)
$comInstanceIds = @()
foreach ($dev in $portsDevices) {
    $comInstanceIds += $dev.PNPDeviceID
}

$kernelNames = @{}
if ($comInstanceIds.Count -gt 0) {
    # Fetch Kernel Names (PDO Name) individually to ensure reliability
    # Batch fetching proved unreliable for mixed device types
    foreach ($id in $comInstanceIds) {
        try {
            $p = Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_PDOName -ErrorAction SilentlyContinue
            if ($p.Data) {
                $kernelNames[$id.ToUpper()] = $p.Data
            }
        } catch {}
    }
}

foreach ($dev in $portsDevices) {
    $currentInstanceId = $dev.PNPDeviceID
    $currentDescription = $dev.Name

    # Extract COM port from description like "Silicon Labs CP210x USB to UART Bridge (COM9)"
    if ($currentDescription -match "\\(COM(\\d+)\\)") {
        $comPort = "COM$($matches[1])"
        $pdoName = $kernelNames[$currentInstanceId.ToUpper()]
        if (-not $pdoName) { $pdoName = "" }
        
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
            Write-Output "COMPORT|$comPort|$parentUsbPath|$channel|$pdoName"
        }
        elseif ($currentInstanceId -match "^USB\\\\") {
            # Regular USB: USB\\VID_10C4&PID_EA60\\xxxx
            Write-Output "COMPORT|$comPort|$currentInstanceId|0|$pdoName"
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

/**
 * Main function to get USB tree data
 * Tries pnputil first (fast), falls back to PowerShell (robust)
 */
function getUSBTreeData(useSlowPath: boolean = false): {
    devices: Map<string, USBDevice>;
    comPorts: Map<string, { instancePath: string; kernelName: string; channel?: number }>;
} {
    if (!useSlowPath) {
        // Try pnputil first
        try {
            return getUSBTreeDataPnputil();
        } catch (error) {
            console.warn('Pnputil enumeration failed, falling back to PowerShell/Registry method:', error instanceof Error ? error.message : String(error));
        }
    }
    
    return getUSBTreeDataPowerShell();
}

/**
 * Build the USB tree with proper parent-child relationships
 */
export function buildUSBTree(useSlowPath: boolean = false): USBTree {
    const { devices, comPorts } = getUSBTreeData(useSlowPath);
    const comPortMap = new Map<string, { device: USBDevice; comInfo: ComPortInfo }>();

    // Assign COM ports to devices
    for (const [comPort, info] of comPorts) {
        const dev = devices.get(info.instancePath.toUpperCase());
        if (dev) {
            const comInfo: ComPortInfo = {
                port: comPort,
                kernelName: info.kernelName,
                channel: info.channel,
                role: info.channel === 1 ? 'JTAG' : (info.channel === 2 ? 'Serial' : undefined),
            };
            dev.comPorts.push(comInfo);
            comPortMap.set(comPort, { device: dev, comInfo });
        }
    }

    // Sort COM ports numerically on each device
    for (const dev of devices.values()) {
        dev.comPorts.sort((a, b) => {
            const numA = parseInt(a.port.replace('COM', ''));
            const numB = parseInt(b.port.replace('COM', ''));
            return numA - numB;
        });
    }

    // Build tree structure - assign children to parents
    for (const dev of devices.values()) {
        if (dev.parentPath) {
            const parent = devices.get(dev.parentPath.toUpperCase());
            if (parent) {
                parent.children.push(dev);
            } else {
                // DEBUG: Log missing parent
                console.log(`Orphan device: ${dev.instancePath} (Parent: ${dev.parentPath})`);
            }
        } else {
            // DEBUG: Log no parent
            console.log(`No parent: ${dev.instancePath}`);
        }
    }

    // Sort children by port number
    for (const dev of devices.values()) {
        dev.children.sort((a, b) => a.portNumber - b.portNumber);
    }

    // Find root hubs (devices with no parent in our device map)
    const rootHubs: USBDevice[] = [];
    for (const dev of devices.values()) {
        if (!dev.parentPath || !devices.has(dev.parentPath.toUpperCase())) {
            if (dev.isHub || dev.vid === 'ROOT') {
                rootHubs.push(dev);
            }
        }
    }

    // Build port chains recursively - starting from 1, not 0 (matches USBTreeView format)
    function buildPortChain(dev: USBDevice, parentChain: string): void {
        if (parentChain) {
            dev.portChain = `${parentChain}-${dev.portNumber}`;
        } else {
            // Root hub starts the chain at 1
            dev.portChain = '1';
        }
        for (const child of dev.children) {
            buildPortChain(child, dev.portChain);
        }
    }

    for (const root of rootHubs) {
        buildPortChain(root, '');
    }

    // Create virtual child devices for multi-port COM devices (e.g., FTDI dual-port)
    // This must be done AFTER port chains are built
    for (const dev of devices.values()) {
        if (dev.comPorts.length > 1) {
            for (const comInfo of dev.comPorts) {
                const channel = comInfo.channel || (dev.comPorts.indexOf(comInfo) + 1);
                const childPortChain = `${dev.portChain}-${channel}`;

                // Create a virtual child device for this COM port
                const childDevice: USBDevice = {
                    instancePath: `${dev.instancePath}#${comInfo.port}`,
                    vid: dev.vid,
                    pid: dev.pid,
                    serialNumber: dev.serialNumber,
                    instanceId: `${dev.instanceId}#${channel}`,
                    parentPath: dev.instancePath,
                    portNumber: channel,
                    isHub: false,
                    name: comInfo.port + (comInfo.role ? ` (${comInfo.role})` : ''),
                    comPorts: [comInfo],  // This child has just this one COM port
                    children: [],
                    portChain: childPortChain,
                    kernelName: comInfo.kernelName,
                };

                // Add to parent's children
                dev.children.push(childDevice);

                // Add to devices map so it can be found by port chain
                devices.set(childDevice.instancePath, childDevice);

                // Update comPortMap to point to the child device
                comPortMap.set(comInfo.port, { device: childDevice, comInfo });
            }

            // Clear COM ports from parent (they're now on children)
            dev.comPorts = [];

            // Sort children by port number (channel)
            dev.children.sort((a, b) => a.portNumber - b.portNumber);
        }
    }

    return { rootHubs, allDevices: devices, comPortMap };
}

/**
 * Find a device by its port chain (e.g., "1-1-3-2-1")
 */
export function getDeviceByPortChain(tree: USBTree, portChain: string): USBDevice | undefined {
    for (const dev of tree.allDevices.values()) {
        if (dev.portChain === portChain) {
            return dev;
        }
    }
    return undefined;
}

/**
 * Find all devices matching a partial port chain prefix (e.g., "1-1-3" returns all devices under that hub)
 */
export function getDevicesByPortChainPrefix(tree: USBTree, prefix: string): USBDevice[] {
    const results: USBDevice[] = [];
    for (const dev of tree.allDevices.values()) {
        if (dev.portChain === prefix || dev.portChain.startsWith(prefix + '-')) {
            results.push(dev);
        }
    }
    // Sort by port chain
    results.sort((a, b) => {
        const partsA = a.portChain.split('-').map(Number);
        const partsB = b.portChain.split('-').map(Number);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const valA = partsA[i] ?? 0;
            const valB = partsB[i] ?? 0;
            if (valA !== valB) return valA - valB;
        }
        return 0;
    });
    return results;
}

/**
 * Print the USB tree to console - format similar to USBTreeView
 */
export function printUSBTree(tree: USBTree): void {
    console.log('USB Device Tree');
    console.log(`Connected Devices: ${tree.allDevices.size}`);
    console.log('');

    function printDevice(dev: USBDevice, prefix: string, isLast: boolean): void {
        const connector = isLast ? '\\--' : '|--';
        const vidPid = dev.vid === 'ROOT' ? '' : ` (${dev.vid.toLowerCase()}:${dev.pid.toLowerCase()})`;

        // Build COM port string for single-port devices (multi-port now have children)
        let comStr = '';
        if (dev.comPorts.length === 1) {
            const c = dev.comPorts[0];
            const roleStr = c.role ? ` (${c.role})` : '';
            comStr = ` - ${c.port}${roleStr}`;
        }

        const serialStr = dev.serialNumber ? ` [S/N: ${dev.serialNumber}]` : '';

        console.log(`${prefix}${connector}[${dev.portChain}]: ${dev.name}${vidPid}${serialStr}${comStr}`);

        const childPrefix = prefix + (isLast ? '    ' : '|   ');

        // Show children (includes virtual COM port children for multi-port devices)
        for (let i = 0; i < dev.children.length; i++) {
            printDevice(dev.children[i], childPrefix, i === dev.children.length - 1);
        }
    }

    for (let i = 0; i < tree.rootHubs.length; i++) {
        const root = tree.rootHubs[i];
        console.log(`\\---USB Root Hub (${root.portChain})`);
        for (let j = 0; j < root.children.length; j++) {
            printDevice(root.children[j], '    ', j === root.children.length - 1);
        }
        console.log('');
    }
}

/**
 * Get a flat list of all COM ports with their device info
 */
export function getComPortList(tree: USBTree): Array<{
    port: string;
    vid: string;
    pid: string;
    serialNumber: string;
    deviceName: string;
    portChain: string;
    kernelName: string;
    channel?: number;
    role?: string;
}> {
    const ports: Array<{
        port: string;
        vid: string;
        pid: string;
        serialNumber: string;
        deviceName: string;
        portChain: string;
        kernelName: string;
        channel?: number;
        role?: string;
    }> = [];

    for (const [, { device, comInfo }] of tree.comPortMap) {
        // For multi-port devices, extend the port chain with the channel number
        const isMultiPort = device.comPorts.length > 1;
        const extendedChain = isMultiPort && comInfo.channel
            ? `${device.portChain}-${comInfo.channel}`
            : device.portChain;

        ports.push({
            port: comInfo.port,
            vid: device.vid,
            pid: device.pid,
            serialNumber: device.serialNumber,
            deviceName: device.name,
            portChain: extendedChain,
            kernelName: comInfo.kernelName,
            channel: comInfo.channel,
            role: comInfo.role,
        });
    }

    // Sort by COM port number
    ports.sort((a, b) => {
        const numA = parseInt(a.port.replace('COM', ''));
        const numB = parseInt(b.port.replace('COM', ''));
        return numA - numB;
    });

    return ports;
}

/**
 * Get device table data
 */
export function getDeviceTable(tree: USBTree): Array<{
    vidPid: string;
    name: string;
    serialNumber: string;
    comPorts: string;
    portChain: string;
    isHub: boolean;
}> {
    const rows: Array<{
        vidPid: string;
        name: string;
        serialNumber: string;
        comPorts: string;
        portChain: string;
        isHub: boolean;
    }> = [];

    function collectDevices(dev: USBDevice): void {
        if (dev.vid === 'ROOT') return;

        const comStr = dev.comPorts.map(c => {
            const roleStr = c.role ? `(${c.role[0]})` : '';
            return `${c.port}${roleStr}`;
        }).join(', ');

        rows.push({
            vidPid: `${dev.vid}:${dev.pid}`,
            name: dev.name,
            serialNumber: dev.serialNumber,
            comPorts: comStr,
            portChain: dev.portChain,
            isHub: dev.isHub,
        });

        for (const child of dev.children) {
            collectDevices(child);
        }
    }

    for (const root of tree.rootHubs) {
        for (const child of root.children) {
            collectDevices(child);
        }
    }

    return rows;
}

// Main execution
if (require.main === module) {
    console.log('=== USB Tree Enumeration (Connected Devices Only) ===\n');

    try {
        const tree = buildUSBTree();

        // DEBUG: Print raw devices to check parent paths
        // console.log('--- Raw Devices ---');
        // for (const dev of tree.allDevices.values()) {
        //    console.log(`${dev.instancePath} -> Parent: ${dev.parentPath}`);
        // }

        // Print tree
        printUSBTree(tree);

        // Print COM ports
        console.log('--- COM Ports ---');
        const comPorts = getComPortList(tree);
        if (comPorts.length > 0) {
            for (const port of comPorts) {
                const role = port.role ? ` (${port.role})` : '';
                const serial = port.serialNumber ? ` [S/N: ${port.serialNumber}]` : '';
                const kernel = port.kernelName ? ` [Kernel: ${port.kernelName}]` : '';
                console.log(`  ${port.port}: ${port.deviceName}${serial}${kernel} [Chain: ${port.portChain}]${role}`);        
            }
        } else {
            console.log('  No COM ports found');
        }
        console.log('');

        // Print device table
        console.log('--- Device Table ---');
        const table = getDeviceTable(tree);
        console.log('VID:PID    | Name                                     | Serial           | COM Ports        | Port Chain');
        console.log('-'.repeat(105));
        for (const row of table) {
            const vidPid = row.vidPid.padEnd(10);
            const name = row.name.substring(0, 40).padEnd(40);
            const serial = (row.serialNumber || '-').padEnd(16);
            const com = (row.comPorts || '-').padEnd(16);
            const chain = row.portChain;
            const hub = row.isHub ? ' [HUB]' : '';
            console.log(`${vidPid} | ${name} | ${serial} | ${com} | ${chain}${hub}`);
        }

    } catch (error) {
        console.error('Error building USB tree:', error);
    }
}
