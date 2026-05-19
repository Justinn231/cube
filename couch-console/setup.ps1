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

$libDir = Join-Path $PSScriptRoot 'lib'
. "$libDir\power.ps1"
. "$libDir\usb-wake.ps1"
. "$libDir\steam.ps1"
. "$libDir\autologin.ps1"

Write-Host '=== Couch Console Setup ===' -ForegroundColor Cyan

# --- 1/4 Power ---
Write-Host "`n[1/4] Energieeinstellungen konfigurieren..."
if (Test-ModernStandby) {
    Write-Host "      Hinweis: Dieses System verwendet Modern Standby (S0ix) statt S3." -ForegroundColor Yellow
    Write-Host "      USB-Wake funktioniert, benoetigt aber korrekte BIOS-Einstellung." -ForegroundColor Yellow
}
Set-CouchPowerPlan

# --- 2/4 USB Wake ---
Write-Host "`n[2/4] USB-Wake fuer 8BitDo-Dongle aktivieren (VID=$Vid PID=$Pid)..."
$found = Enable-UsbWake -Vid $Vid -Pid $Pid
if (-not $found) {
    Write-Warning "      Dongle jetzt nicht gefunden. Einstecken und .\setup.ps1 erneut ausfuehren."
}

# --- 3/4 Steam ---
Write-Host "`n[3/4] Steam Big Picture Task installieren..."
if (-not $SteamExe) { $SteamExe = Find-SteamExe }
if (-not $SteamExe) {
    Write-Error "Steam nicht gefunden. Steam installieren oder -SteamExe 'C:\...\steam.exe' angeben."
}
Install-SteamBigPictureTask -SteamExe $SteamExe

# --- 4/4 Auto-Login ---
if ($EnableAutoLogin) {
    Write-Host "`n[4/4] Auto-Login einrichten..."
    Enable-AutoLogin -Username $env:USERNAME
} else {
    Write-Host "`n[4/4] Auto-Login uebersprungen (mit -EnableAutoLogin aktivieren)."
}

Write-Host @"

=== MANUELLE SCHRITTE ERFORDERLICH ===

BIOS/UEFI (einmalig):
  1. PC neu starten, BIOS oeffnen (meist DEL oder F2)
  2. Suche nach einer dieser Optionen und aktiviere sie:
       "USB Wake Support"  |  "Power On By USB"  |  "Wake from S3 by USB"
  3. Speichern und BIOS verlassen

Geraete-Manager (einmalig):
  1. devmgmt.msc oeffnen
  2. "USB-Controller" aufklappen
  3. Alle "USB Root Hub" -> Rechtsklick -> Eigenschaften -> Energieverwaltung
  4. Haken setzen: "Computer kann dieses Geraet aus dem Ruhezustand wecken"

=== SETUP ABGESCHLOSSEN ===

Verwendung:
  - PC schlafen legen: Start -> Energie -> Ruhezustand (NICHT Herunterfahren)
  - Aufwecken: Home-Button am 8BitDo-Controller druecken
  - Steam Big Picture startet automatisch nach dem Login

Zum Rueckgaengigmachen: .\uninstall.ps1
"@ -ForegroundColor Green
