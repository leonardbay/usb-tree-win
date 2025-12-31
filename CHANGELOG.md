# Changelog

All notable changes to this project will be documented in this file.

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
