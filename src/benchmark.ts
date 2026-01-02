import { buildUSBTree, USBTree, USBDevice } from './usb-tree';
import { performance } from 'perf_hooks';

function compareTrees(fast: USBTree, slow: USBTree) {
    const differences: string[] = [];

    // 1. Compare Device Counts
    if (fast.allDevices.size !== slow.allDevices.size) {
        differences.push(`Device count mismatch: Fast=${fast.allDevices.size}, Slow=${slow.allDevices.size}`);
    }

    // 2. Compare Devices
    const fastKeys = Array.from(fast.allDevices.keys()).sort();
    const slowKeys = Array.from(slow.allDevices.keys()).sort();

    // Check for missing/extra devices
    const missingInSlow = fastKeys.filter(k => !slow.allDevices.has(k));
    const missingInFast = slowKeys.filter(k => !fast.allDevices.has(k));

    if (missingInSlow.length > 0) differences.push(`Devices in Fast but not Slow: ${missingInSlow.join(', ')}`);
    if (missingInFast.length > 0) differences.push(`Devices in Slow but not Fast: ${missingInFast.join(', ')}`);

    // Compare common devices
    for (const key of fastKeys) {
        if (!slow.allDevices.has(key)) continue;

        const fDev = fast.allDevices.get(key)!;
        const sDev = slow.allDevices.get(key)!;

        const compareField = (field: keyof USBDevice) => {
            const v1 = JSON.stringify(fDev[field]);
            const v2 = JSON.stringify(sDev[field]);
            if (v1 !== v2) {
                // Ignore children circular ref for JSON stringify, but we are comparing fields.
                // Children is an array of objects, which will cause circular structure error if stringified directly if they link back.
                // But USBDevice interface has children: USBDevice[].
                // Let's skip 'children' and 'comPorts' for simple stringify, handle them separately.
                if (field === 'children') return; 
                
                // Normalize potential undefined vs empty string differences if any
                if ((!fDev[field] && !sDev[field])) return;

                differences.push(`Device ${key} mismatch on ${field}: Fast='${fDev[field]}', Slow='${sDev[field]}'`);
            }
        };

        compareField('vid');
        compareField('pid');
        compareField('serialNumber');
        compareField('parentPath');
        compareField('portNumber');
        compareField('portChain');
        compareField('isHub');
        // compareField('name'); // Names might differ slightly (Registry vs Pnputil output)
        
        // Compare COM ports
        if (fDev.comPorts.length !== sDev.comPorts.length) {
            differences.push(`Device ${key} COM port count mismatch: Fast=${fDev.comPorts.length}, Slow=${sDev.comPorts.length}`);
        } else {
            for (let i = 0; i < fDev.comPorts.length; i++) {
                const cp1 = fDev.comPorts[i];
                const cp2 = sDev.comPorts[i];
                if (cp1.port !== cp2.port || cp1.kernelName !== cp2.kernelName) {
                     differences.push(`Device ${key} COM port mismatch: Fast=${JSON.stringify(cp1)}, Slow=${JSON.stringify(cp2)}`);
                }
            }
        }
    }

    return differences;
}

async function runBenchmark() {
    console.log('Starting Benchmark...');
    console.log('----------------------------------------');

    // Warmup (optional, but good for JIT)
    // buildUSBTree(false); 

    // Measure Fast Path
    const startFast = performance.now();
    const treeFast = buildUSBTree(false);
    const endFast = performance.now();
    const timeFast = endFast - startFast;
    console.log(`Fast Path (Pnputil): ${timeFast.toFixed(2)} ms`);
    console.log(`  - Devices: ${treeFast.allDevices.size}`);
    console.log(`  - COM Ports: ${treeFast.comPortMap.size}`);

    // Measure Slow Path
    const startSlow = performance.now();
    const treeSlow = buildUSBTree(true);
    const endSlow = performance.now();
    const timeSlow = endSlow - startSlow;
    console.log(`Slow Path (PowerShell): ${timeSlow.toFixed(2)} ms`);
    console.log(`  - Devices: ${treeSlow.allDevices.size}`);
    console.log(`  - COM Ports: ${treeSlow.comPortMap.size}`);

    console.log('----------------------------------------');
    
    // Comparison
    const speedup = timeSlow / timeFast;
    console.log(`Speedup Factor: ${speedup.toFixed(2)}x`);
    console.log(`Absolute Difference: ${(timeSlow - timeFast).toFixed(2)} ms`);

    console.log('----------------------------------------');
    console.log('Verifying Results Consistency...');
    const diffs = compareTrees(treeFast, treeSlow);
    
    if (diffs.length === 0) {
        console.log('SUCCESS: Both methods produced identical trees (ignoring minor name variations).');
    } else {
        console.log('WARNING: Differences detected between methods:');
        diffs.slice(0, 10).forEach(d => console.log(`  - ${d}`));
        if (diffs.length > 10) console.log(`  ... and ${diffs.length - 10} more differences.`);
    }
}

runBenchmark();
