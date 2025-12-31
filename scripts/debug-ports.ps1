$comRegPath = 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM';
$enumPath = 'HKLM:\SYSTEM\CurrentControlSet\Enum';

# Get all COM port mappings: DevicePath -> COM port
$comMappings = @{};
Get-Item $comRegPath | ForEach-Object {
    $_.GetValueNames() | ForEach-Object {
        $devicePath = $_;
        $comPort = (Get-ItemProperty $comRegPath).$devicePath;
        $comMappings[$devicePath] = $comPort;
    }
}

Write-Host "COM Mappings:" -ForegroundColor Cyan;
$comMappings.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key) -> $($_.Value)" };
Write-Host "";

# Now find each device and its hardware ID
Write-Host "Searching for USB devices..." -ForegroundColor Cyan;
Get-ChildItem "$enumPath\USB" -Recurse -ErrorAction SilentlyContinue |
ForEach-Object {
    $parentHW = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).HardwareID;
    if ($parentHW) {
        Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue |
        ForEach-Object {
            $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;
            if ($props.PortName) {
                $portName = $props.PortName;
                # Find which device path maps to this PortName value as a COM port
                foreach ($mapping in $comMappings.GetEnumerator()) {
                    if ($mapping.Value -eq $portName) {
                        Write-Host "$($mapping.Value): $($parentHW[0])";
                    }
                }
            }
        }
    }
}

Write-Host "";
Write-Host "Searching for FTDIBUS devices..." -ForegroundColor Cyan;
Get-ChildItem "$enumPath\FTDIBUS" -Recurse -ErrorAction SilentlyContinue |
ForEach-Object {
    $parentHW = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).HardwareID;
    if ($parentHW) {
        Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue |
        ForEach-Object {
            $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;
            if ($props.PortName) {
                $portName = $props.PortName;
                # Find which device path maps to this PortName value as a COM port
                foreach ($mapping in $comMappings.GetEnumerator()) {
                    if ($mapping.Value -eq $portName) {
                        Write-Host "$($mapping.Value): $($parentHW[0])";
                    }
                }
            }
        }
    }
}

