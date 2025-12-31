# Changelog

All notable changes to this project will be documented in this file.

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
