/**
 * USBView TypeScript - Main Entry Point
 * USB tree enumeration with COM port mapping for Windows 11
 */

import { buildUSBTree, printUSBTree, getComPortList, getDeviceTable, getDeviceByPortChain, getDevicesByPortChainPrefix, USBTree, USBDevice, ComPortInfo } from './usb-tree';

function main() {
    console.log('=== USB Tree Enumeration (Connected Devices Only) ===\n');

    try {
        const tree = buildUSBTree();

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
        console.error('Error enumerating USB devices:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

// Export for use as a module
export { buildUSBTree, printUSBTree, getComPortList, getDeviceTable, getDeviceByPortChain, getDevicesByPortChainPrefix, USBTree, USBDevice, ComPortInfo };

