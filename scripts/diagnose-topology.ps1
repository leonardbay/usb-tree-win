# Diagnose USB topology - what data do we actually have?
# Goal: understand parent-child relationships and real serial numbers

Write-Host "=== USB Device Topology Diagnosis ===" -ForegroundColor Cyan
Write-Host ""

# Get all USB devices from registry
$usbPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB"
$devices = @()

Get-ChildItem $usbPath -ErrorAction SilentlyContinue | ForEach-Object {
    $vidPidKey = $_.PSChildName
    Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
        $instanceId = $_.PSChildName
        $fullPath = $_.PSPath
        $props = Get-ItemProperty $fullPath -ErrorAction SilentlyContinue
        
        $devices += [PSCustomObject]@{
            VidPid = $vidPidKey
            InstanceId = $instanceId
            FullInstancePath = "USB\$vidPidKey\$instanceId"
            FriendlyName = $props.FriendlyName
            DeviceDesc = $props.DeviceDesc
            LocationInfo = $props.LocationInformation
            ParentIdPrefix = $props.ParentIdPrefix
            Driver = $props.Driver
            Service = $props.Service
            ContainerId = $props.ContainerId
        }
    }
}

Write-Host "Found $($devices.Count) USB device instances" -ForegroundColor Green
Write-Host ""

# Now get parent info using PnP
Write-Host "=== Device Parent-Child Relationships ===" -ForegroundColor Cyan
Write-Host ""

foreach ($dev in $devices) {
    $instancePath = $dev.FullInstancePath
    
    # Use pnputil to get parent
    try {
        $pnpOutput = pnputil /enum-devices /instanceid "$instancePath" /relations 2>$null
        $parentLine = $pnpOutput | Select-String "Parent"
        
        Write-Host "Device: $instancePath" -ForegroundColor Yellow
        Write-Host "  FriendlyName: $($dev.FriendlyName)"
        Write-Host "  Location: $($dev.LocationInfo)"
        Write-Host "  ParentIdPrefix: $($dev.ParentIdPrefix)"
        if ($parentLine) {
            Write-Host "  $parentLine" -ForegroundColor Green
        }
        Write-Host ""
    } catch {
        Write-Host "Device: $instancePath - error getting parent" -ForegroundColor Red
    }
}

# Also check USBHUB devices
Write-Host "=== USB Hub Devices ===" -ForegroundColor Cyan
$hubPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\USBROOT"
if (Test-Path $hubPath) {
    Get-ChildItem $hubPath -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host $_.PSPath
    }
}

# Check for USB host controllers
Write-Host ""
Write-Host "=== USB Host Controllers (PCI) ===" -ForegroundColor Cyan
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Enum\PCI" -ErrorAction SilentlyContinue | Where-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    $props.DeviceDesc -like "*USB*" -or $props.FriendlyName -like "*USB*"
} | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    Write-Host "  $($_.PSChildName): $($props.FriendlyName)"
}
