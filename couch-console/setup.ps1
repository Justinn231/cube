#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Richtet den PC als Couch Console ein:
    USB-Wake aus dem Schlafmodus + Steam Big Picture beim Start.

.PARAMETER Vid
    USB Vendor-ID des 8BitDo-Dongles (Standard: 2DC8)

.PARAMETER Pid
    USB Product-ID des 8BitDo-Dongles (Standard: 3106)

.PARAMETER EnableAutoLogin
    Wenn gesetzt: Windows Auto-Login einrichten (Passwort wird im Klartext gespeichert).

.PARAMETER SteamExe
    Optionaler Pfad zu steam.exe, falls nicht automatisch erkannt.

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -EnableAutoLogin
    .\setup.ps1 -Vid 2DC8 -Pid 3106 -SteamExe "D:\Steam\steam.exe"
#>
param(
    [string]$Vid = '2DC8',
    [string]$Pid = '3106',
    [switch]$EnableAutoLogin,
    [string]$SteamExe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Power helpers
# ---------------------------------------------------------------------------

function Set-CouchPowerPlan {
    # Disable hibernate so USB wake fires from S3/S0ix instead of S4
    powercfg /hibernate off

    powercfg /change monitor-timeout-ac 30
    powercfg /change standby-timeout-ac 60
    powercfg /change monitor-timeout-dc 10
    powercfg /change standby-timeout-dc 20

    # Disable Fast Startup: "shutdown" becomes real shutdown, not hibernate.
    # Without this, pressing the controller after a shutdown does nothing.
    Set-ItemProperty `
        -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' `
        -Name HiberbootEnabled -Value 0 -Type DWord -Force

    # Enable USB wake in current power scheme
    # Subgroup 2a737441-... = USB settings | Setting d4e98f31-... = USB wake
    powercfg /setacvalueindex SCHEME_CURRENT `
        2a737441-1930-4402-8d77-b2bebba308a3 `
        d4e98f31-5ffe-4ce1-be31-1b38b384c009 1
    powercfg /setdcvalueindex SCHEME_CURRENT `
        2a737441-1930-4402-8d77-b2bebba308a3 `
        d4e98f31-5ffe-4ce1-be31-1b38b384c009 1

    powercfg /setactive SCHEME_CURRENT
    Write-Host "[power] Energieeinstellungen angewendet."
}

function Test-ModernStandby {
    return ((powercfg /a) -match 'S0 Low Power Idle')
}

# ---------------------------------------------------------------------------
# USB wake helpers
# ---------------------------------------------------------------------------

function Enable-UsbWake {
    param([string]$Vid, [string]$Pid)

    $devices = Get-WmiObject Win32_PnPEntity |
        Where-Object { $_.DeviceID -like "USB\VID_${Vid}&PID_${Pid}*" }

    if (-not $devices) {
        Write-Warning "[usb-wake] 8BitDo-Dongle (VID=$Vid PID=$Pid) nicht gefunden."
        Write-Warning "           Dongle einstecken und .\setup.ps1 erneut ausfuehren."
        return $false
    }

    foreach ($dev in $devices) {
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($dev.DeviceID)\Device Parameters"
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        Set-ItemProperty -Path $regPath -Name WakeEnabled -Value 1 -Type DWord -Force
        Write-Host "[usb-wake] WakeEnabled=1 gesetzt fuer: $($dev.DeviceID)"
    }

    # Enable wake on all USB Root Hubs so the signal propagates to the host
    Get-WmiObject Win32_PnPEntity |
        Where-Object { $_.Description -match 'Root Hub' -and $_.DeviceID -like 'USB\*' } |
        ForEach-Object {
            $hubPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($_.DeviceID)\Device Parameters"
            if (Test-Path $hubPath) {
                Set-ItemProperty -Path $hubPath -Name WakeEnabled -Value 1 -Type DWord -Force
            }
        }
    Write-Host "[usb-wake] USB Root Hubs fuer Wake aktiviert."
    return $true
}

# ---------------------------------------------------------------------------
# Steam helpers
# ---------------------------------------------------------------------------

function Find-SteamExe {
    $candidates = @(
        'C:\Program Files (x86)\Steam\steam.exe',
        'C:\Program Files\Steam\steam.exe',
        (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -Name SteamExe -EA 0)?.SteamExe,
        ((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -Name InstallPath -EA 0)?.InstallPath + '\steam.exe')
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    return $null
}

function Install-SteamBigPictureTask {
    param([string]$SteamExe)

    $taskName = 'CouchConsole-SteamBigPicture'
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue

    $action   = New-ScheduledTaskAction -Execute $SteamExe -Argument '-bigpicture'

    # Two triggers: logon (first boot) + session unlock (every wake-from-sleep)
    $triggerLogon = New-ScheduledTaskTrigger -AtLogOn
    $triggerUnlock = New-CimInstance `
        -Namespace ROOT\Microsoft\Windows\TaskScheduler `
        -ClassName MSFT_TaskSessionStateChangeTrigger `
        -ClientOnly `
        -Property @{ StateChange = 8 }   # 8 = SESSION_UNLOCK

    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 0) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable

    $principal = New-ScheduledTaskPrincipal `
        -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive `
        -RunLevel Limited

    $task = New-ScheduledTask `
        -Action $action `
        -Trigger @($triggerLogon, $triggerUnlock) `
        -Settings $settings `
        -Principal $principal

    Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
    Write-Host "[steam] Task '$taskName' registriert."
}

# ---------------------------------------------------------------------------
# Auto-login helpers
# ---------------------------------------------------------------------------

function Enable-AutoLogin {
    param([string]$Username)

    $cred = Get-Credential -UserName $Username -Message "Windows-Passwort fuer Auto-Login eingeben"
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password)
    )

    $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty $wl AutoAdminLogon    '1'
    Set-ItemProperty $wl DefaultUserName   $Username
    Set-ItemProperty $wl DefaultPassword   $plain
    Set-ItemProperty $wl DefaultDomainName $env:COMPUTERNAME

    Write-Warning "[autologin] Passwort in HKLM Winlogon im Klartext gespeichert. Nur auf physisch gesichertem PC verwenden."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host '=== Couch Console Setup ===' -ForegroundColor Cyan

Write-Host "`n[1/4] Energieeinstellungen konfigurieren..."
if (Test-ModernStandby) {
    Write-Host "      Hinweis: Dieses System nutzt Modern Standby (S0ix) statt S3." -ForegroundColor Yellow
    Write-Host "      USB-Wake funktioniert, benoetigt aber korrekte BIOS-Einstellung." -ForegroundColor Yellow
}
Set-CouchPowerPlan

Write-Host "`n[2/4] USB-Wake fuer 8BitDo-Dongle aktivieren (VID=$Vid PID=$Pid)..."
Enable-UsbWake -Vid $Vid -Pid $Pid | Out-Null

Write-Host "`n[3/4] Steam Big Picture Task installieren..."
if (-not $SteamExe) { $SteamExe = Find-SteamExe }
if (-not $SteamExe) {
    Write-Error "Steam nicht gefunden. Steam installieren oder -SteamExe 'C:\...\steam.exe' angeben."
}
Install-SteamBigPictureTask -SteamExe $SteamExe

if ($EnableAutoLogin) {
    Write-Host "`n[4/4] Auto-Login einrichten..."
    Enable-AutoLogin -Username $env:USERNAME
} else {
    Write-Host "`n[4/4] Auto-Login uebersprungen (mit -EnableAutoLogin aktivieren)."
}

Write-Host @"

=== MANUELLE SCHRITTE ERFORDERLICH ===

BIOS/UEFI (einmalig nach Ersteinrichtung):
  1. PC neu starten, BIOS oeffnen (meist DEL oder F2 beim Boot)
  2. Eine dieser Optionen aktivieren:
       "USB Wake Support"  |  "Power On By USB"  |  "Wake from S3 by USB"
  3. Speichern und BIOS verlassen

Geraete-Manager (einmalig):
  1. devmgmt.msc oeffnen
  2. "Universal Serial Bus Controller" aufklappen
  3. Jeden "USB Root Hub" -> Rechtsklick -> Eigenschaften -> Energieverwaltung
  4. Haken setzen bei: "Computer kann dieses Geraet aus dem Ruhezustand wecken"

Verifikation:
  powercfg /devicequery wake_armed   (zeigt Wake-faehige Geraete)

=== SETUP ABGESCHLOSSEN ===

Nutzung:
  - Spielen  : Steam normal oeffnen oder Big Picture direkt nutzen
  - Schlafen : Start -> Energie -> Ruhezustand  (NICHT Herunterfahren)
  - Aufwecken: Home-Button am 8BitDo-Controller druecken (~2 Sek)
  - Danach   : Steam Big Picture startet automatisch

Rueckgaengig machen: .\uninstall.ps1
"@ -ForegroundColor Green
