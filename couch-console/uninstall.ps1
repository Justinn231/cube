#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Macht alle Aenderungen von setup.ps1 rueckgaengig.

.PARAMETER Vid
.PARAMETER Pid
    Dieselben Werte wie bei setup.ps1 (Standard passt zum 8BitDo Ultimate2).
#>
param(
    [string]$Vid = '2DC8',
    [string]$Pid = '3106'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Power restore
# ---------------------------------------------------------------------------

function Restore-DefaultPowerPlan {
    powercfg /hibernate on

    powercfg /change monitor-timeout-ac 15
    powercfg /change standby-timeout-ac 30
    powercfg /change monitor-timeout-dc 5
    powercfg /change standby-timeout-dc 15

    Set-ItemProperty `
        -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' `
        -Name HiberbootEnabled -Value 1 -Type DWord -Force

    Write-Host "[power] Windows-Standardeinstellungen wiederhergestellt."
}

# ---------------------------------------------------------------------------
# USB wake disable
# ---------------------------------------------------------------------------

function Disable-UsbWake {
    param([string]$Vid, [string]$Pid)

    Get-WmiObject Win32_PnPEntity |
        Where-Object { $_.DeviceID -like "USB\VID_${Vid}&PID_${Pid}*" } |
        ForEach-Object {
            $regPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($_.DeviceID)\Device Parameters"
            if (Test-Path $regPath) {
                Set-ItemProperty -Path $regPath -Name WakeEnabled -Value 0 -Type DWord -Force
                Write-Host "[usb-wake] WakeEnabled=0 fuer: $($_.DeviceID)"
            }
        }
}

# ---------------------------------------------------------------------------
# Steam task remove
# ---------------------------------------------------------------------------

function Remove-SteamBigPictureTask {
    $taskName = 'CouchConsole-SteamBigPicture'
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue
    Write-Host "[steam] Task '$taskName' entfernt."
}

# ---------------------------------------------------------------------------
# Auto-login disable
# ---------------------------------------------------------------------------

function Disable-AutoLogin {
    $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty $wl AutoAdminLogon '0'
    Remove-ItemProperty $wl DefaultPassword -EA SilentlyContinue
    Write-Host "[autologin] Auto-Login deaktiviert und Passwort geloescht."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host '=== Couch Console Deinstallation ===' -ForegroundColor Yellow

Write-Host "`n[1/4] Energieeinstellungen zuruecksetzen..."
Restore-DefaultPowerPlan

Write-Host "`n[2/4] USB-Wake deaktivieren..."
Disable-UsbWake -Vid $Vid -Pid $Pid

Write-Host "`n[3/4] Steam Big Picture Task entfernen..."
Remove-SteamBigPictureTask

Write-Host "`n[4/4] Auto-Login deaktivieren..."
Disable-AutoLogin

Write-Host "`nDeinstallation abgeschlossen." -ForegroundColor Green
