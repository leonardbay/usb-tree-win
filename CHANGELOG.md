# Changelog

All notable changes to this project will be documented in this file.

## [1.0.6] - 2026-01-02
### Added
- **Fast Path Restoration**: Restored the high-performance `pnputil` implementation (ported from v1.0.1) as the default enumeration method. This is approximately 7x faster than the PowerShell/WMI method.
- **Kernel Name Support**: Added extraction of Kernel Names (PDO Names, e.g., `\Device\USBPDO-6`) for COM ports in the fast path.
- **Dual-Path Strategy**: Introduced an optional `useSlowPath` boolean parameter to `buildUSBTree` and `getUSBTreeData`.
  - `false` (default): Tries the fast `pnputil` method first. If it fails, automatically falls back to the slower PowerShell method.
  - `true`: Forces the use of the slower, more robust PowerShell/WMI method (skipping the fast path).
- **Benchmark Utility**: Added `src/benchmark.ts` to measure and compare the performance and accuracy of both methods.

## [1.0.5] - 2025-12-31
### Fixed
- Added additional safety net for parent device lookups. If batch fetching returns incomplete results (causing missing devices in the tree), the system now attempts an immediate individual fetch during tree construction. This fixes intermittent "missing device" issues.

## [1.0.4] - 2025-12-31
### Fixed
- Fixed regression where batch fetching of `DEVPKEY_Device_Parent` failed for some devices, causing broken tree structures. Implemented robust fallback to individual fetching.
- Fixed regression where batch fetching of `DEVPKEY_Device_PDOName` failed, causing missing Kernel names. Switched to individual fetching for reliability.

## [1.0.3] - 2025-12-31
### Fixed
- Fixed regressions introduced in 1.0.2:
  - Fixed missing parent/child relationships for some devices (caused by WMI query limits).
  - Fixed missing kernel names for COM ports.
  - Fixed root hub numbering to be sequential.
  - Fixed orphaned devices in the tree view.

## [1.0.2] - 2025-12-31

### Changed
- Replaced `pnputil` dependency with native PowerShell CIM/WMI calls (`Get-CimInstance`) for significantly improved performance (~3x faster).
- Optimized parent-child relationship lookups using in-memory batch processing.

### Fixed
- Fixed FTDI COM port enumeration issues caused by case-sensitivity mismatches between Registry and CIM keys.

### Removed
- Removed obsolete PowerShell helper scripts (`pnputil-compat.ps1`, `enumerate-usb.ps1`, etc).

## [1.0.1] - 2025-12-31
### Added
- url paths to package.json

## [1.0.0] - 2025-12-31

### Added
- Initial release
- USB device tree enumeration using Windows pnputil
- Port chain identification matching USBTreeView format (e.g., `1-1-3-2`)
- COM port mapping with correct device association
- FTDI dual-port support with JTAG/Serial child devices
- Serial number detection (distinguishes real serials from Windows instance IDs)
- API functions: `buildUSBTree`, `getDeviceByPortChain`, `getDevicesByPortChainPrefix`, `getComPortList`, `getDeviceTable`
- TypeScript type definitions included
