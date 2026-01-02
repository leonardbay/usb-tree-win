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
            for (const dev of comPorts) {
                const comInfo = dev.comPorts[0];
                const role = comInfo.role ? ` (${comInfo.role})` : '';
                const serial = dev.serialNumber ? ` [S/N: ${dev.serialNumber}]` : '';
                const kernel = dev.kernelName ? ` [Kernel: ${dev.kernelName}]` : '';
                console.log(`  ${comInfo.port}: ${dev.name}${serial}${kernel} [Chain: ${dev.portChain}]${role}`);
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
        for (const dev of table) {
            const vidPid = `${dev.vid}:${dev.pid}`.padEnd(10);
            const name = dev.name.substring(0, 40).padEnd(40);
            const serial = (dev.serialNumber || '-').padEnd(16);
            
            const comStr = dev.comPorts.map(c => {
                const roleStr = c.role ? `(${c.role[0]})` : '';
                return `${c.port}${roleStr}`;
            }).join(', ');
            const com = (comStr || '-').padEnd(16);
            
            const chain = dev.portChain;
            const hub = dev.isHub ? ' [HUB]' : '';
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

