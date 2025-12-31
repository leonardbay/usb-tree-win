# USBView TypeScript - USB Device Tree for Windows 11

A Node.js TypeScript implementation of USB device tree enumeration for Windows, inspired by [USBTreeView](https://www.uwe-sieber.de/usbtreeview_e.html). Enumerates connected USB devices with proper hub hierarchy, COM port mapping, and port chain identification.

## Features

- **USB Device Tree**: Hierarchical tree showing actual USB topology (hubs and devices)
- **Port Chain**: Each device has a port chain (e.g., `1-1-3-2`) matching [USBTreeView](https://www.uwe-sieber.de/usbtreeview_e.html) format
- **COM Port Mapping**: Correctly associates COM ports with their USB devices
- **FTDI Dual-Port Support**: FTDI devices show as parent with JTAG/Serial children (e.g., `1-1-3-2-1`, `1-1-3-2-2`)
- **Serial Number Detection**: Distinguishes real device serials from Windows instance IDs
- **Connected Devices Only**: Only shows currently connected devices (no phantom devices)
- **No Native Dependencies**: Uses Windows built-in tools (PowerShell, CIM/WMI) - no gyp/C++ compilation needed

## Installation

```bash
npm install
```

## Usage

### Command Line

```bash
npm run build
npm start
```

### As a Module

```typescript
import { 
    buildUSBTree, 
    printUSBTree, 
    getDeviceByPortChain,
    getDevicesByPortChainPrefix,
    getComPortList 
} from './src/usb-tree';

// Build the tree
const tree = buildUSBTree();

// Print formatted tree
printUSBTree(tree);

// Find device by exact port chain
const device = getDeviceByPortChain(tree, '1-1-3-2-1');
console.log(device?.name, device?.comPorts[0]?.port);  // "COM26 (JTAG)" "COM26"

// Find all devices under a hub
const devices = getDevicesByPortChainPrefix(tree, '1-1-3');

// Get flat list of COM ports
const comPorts = getComPortList(tree);
for (const port of comPorts) {
    console.log(`${port.port}: ${port.deviceName} [${port.portChain}]`);
}
```

## Example Output

```
USB Device Tree
Connected Devices: 18

\---USB Root Hub (1)
    |--[1-1]: USB 2.0 Hub (0bda:5411)
    |   |--[1-1-1]: CP210x USB-UART (10c4:ea60) [S/N: 0001] - COM9
    |   |--[1-1-3]: USB 2.0 Hub (0bda:5411)
    |   |   |--[1-1-3-1]: STM32 Virtual COM Port (0483:5740) [S/N: 5D8741883231] - COM3
    |   |   |--[1-1-3-2]: FT2232H Dual Serial (0403:6010)
    |   |   |   |--[1-1-3-2-1]: COM26 (JTAG) (0403:6010) - COM26 (JTAG)
    |   |   |   \--[1-1-3-2-2]: COM27 (Serial) (0403:6010) - COM27 (Serial)
    |   |   |--[1-1-3-3]: FT2232H Dual Serial (0403:6010)
    |   |   |   |--[1-1-3-3-1]: COM32 (JTAG) (0403:6010) - COM32 (JTAG)
    |   |   |   \--[1-1-3-3-2]: COM33 (Serial) (0403:6010) - COM33 (Serial)
    |   |   \--[1-1-3-4]: USB 2.0 Hub (0bda:5411)
    |   |       \--[1-1-3-4-2]: USB-1208FS-Plus (09db:00e8) [S/N: 024ECE03]

--- COM Ports ---
  COM3: STM32 Virtual COM Port [S/N: 5D8741883231] [Chain: 1-1-3-1]
  COM9: CP210x USB-UART [S/N: 0001] [Chain: 1-1-1]
  COM26: COM26 (JTAG) [Chain: 1-1-3-2-1] (JTAG)
  COM27: COM27 (Serial) [Chain: 1-1-3-2-2] (Serial)
```

## API

### `buildUSBTree(): USBTree`
Builds and returns the complete USB device tree.

### `printUSBTree(tree: USBTree): void`
Prints the tree to console in a formatted view.

### `getDeviceByPortChain(tree: USBTree, portChain: string): USBDevice | undefined`
Find a device by its exact port chain (e.g., `"1-1-3-2-1"`).

### `getDevicesByPortChainPrefix(tree: USBTree, prefix: string): USBDevice[]`
Find all devices under a port chain prefix (e.g., `"1-1-3"` returns the hub and all children).

## Troubleshooting

If you encounter issues with device enumeration, a PowerShell script is provided in the `scripts/` directory:

- `scripts/debug-ports.ps1`: Enumerates COM ports using the Windows Registry (`HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM`) instead of CIM/WMI. This is useful for verifying if a COM port is actually registered by the system even if the main application fails to map it.

### `getComPortList(tree: USBTree): ComPortInfo[]`
Get a flat list of all COM ports with device info and port chains.

### `getDeviceTable(tree: USBTree): DeviceTableRow[]`
Get tabular data for all devices.

## Project Structure

```
src/
├── index.ts      # Entry point and exports
└── usb-tree.ts   # USB tree enumeration logic
scripts/
└── debug-ports.ps1       # Diagnostic: enumerate COM ports from registry
```

## Requirements

- Node.js 16+
- Windows 10/11
- PowerShell (built into Windows)

## How It Works

Uses native PowerShell CIM/WMI commands (`Get-CimInstance`) to enumerate connected USB and USBDevice class devices directly from the Windows Object Manager. It builds the topology by querying parent-child relationships and mapping COM ports from the Ports device class. No native modules, `pnputil`, or libusb required.

## Author

Leonard Bay

## License

MIT - See [LICENSE](LICENSE) for details.
