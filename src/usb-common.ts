/**
 * USB Tree Common Definitions and Helpers
 */

// Interfaces
export interface USBDevice {
    instancePath: string;
    vid: string;
    pid: string;
    serialNumber: string;      // Actual device serial (empty if none)
    instanceId: string;        // Windows instance ID (not serial)
    parentPath: string | null;
    portNumber: number;
    isHub: boolean;
    name: string;
    comPorts: ComPortInfo[];
    children: USBDevice[];
    portChain: string;
    kernelName: string;
}

export interface ComPortInfo {
    port: string;
    kernelName: string;        // \Device\00000209 - changes on replug
    channel?: number;          // 1 = JTAG/A, 2 = Serial/B for FTDI
    role?: 'JTAG' | 'Serial';
}

export interface USBTree {
    rootHubs: USBDevice[];
    allDevices: Map<string, USBDevice>;
    comPortMap: Map<string, { device: USBDevice; comInfo: ComPortInfo }>;
}

// Vendor/Product database
export const VENDORS: Record<string, string> = {
    '0403': 'FTDI',
    '0483': 'STMicroelectronics',
    '046D': 'Logitech',
    '04F2': 'Chicony',
    '05E3': 'Genesys Logic',
    '06CB': 'Synaptics',
    '0781': 'SanDisk',
    '09DB': 'Digilent/MCC',
    '0BDA': 'Realtek',
    '10C4': 'Silicon Labs',
    '1A86': 'QinHeng (CH340)',
    '303A': 'Espressif',
    '8087': 'Intel',
    'C282': 'USB-IF',
};

export const PRODUCTS: Record<string, string> = {
    '0403:6010': 'FT2232H Dual Serial',
    '0403:6001': 'FT232R Serial',
    '0403:6015': 'FT231X Serial',
    '0483:5740': 'STM32 Virtual COM Port',
    '046D:085E': 'BRIO Webcam',
    '04F2:B61E': 'Integrated Webcam',
    '05E3:0610': 'USB 2.0 Hub',
    '05E3:0626': 'USB 3.0 Hub',
    '06CB:0081': 'Fingerprint Sensor',
    '09DB:007A': 'USB-1608G DAQ',
    '09DB:00E8': 'USB-1208FS-Plus',
    '0BDA:0411': 'USB 3.0 Hub',
    '0BDA:5411': 'USB 2.0 Hub',
    '0BDA:8153': 'USB GbE Controller',
    '0BDA:B023': 'Bluetooth Adapter',
    '10C4:EA60': 'CP210x USB-UART',
    '1A86:7523': 'CH340 USB-Serial',
    '303A:1001': 'ESP32-S3 USB JTAG/Serial',
    'C282:3311': 'USB Serial Device',
};

export function getDeviceName(vid: string, pid: string, rawName: string): string {
    const key = `${vid.toUpperCase()}:${pid.toUpperCase()}`;
    if (PRODUCTS[key]) {
        return PRODUCTS[key];
    }

    // Clean up Windows inf-style names
    if (rawName.startsWith('@')) {
        const vendor = VENDORS[vid.toUpperCase()] || `Vendor ${vid}`;
        if (rawName.includes('roothub')) {
            return 'USB Root Hub';
        }
        if (rawName.includes('hub')) {
            return `USB Hub`;
        }
        if (rawName.includes('composite')) {
            return `USB Composite Device`;
        }
        return `${vendor} Device`;
    }

    return rawName || `${VENDORS[vid.toUpperCase()] || vid}:${pid}`;
}
