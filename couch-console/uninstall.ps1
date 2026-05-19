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

$libDir = Join-Path $PSScriptRoot 'lib'
. "$libDir\power.ps1"
. "$libDir\usb-wake.ps1"
. "$libDir\steam.ps1"
. "$libDir\autologin.ps1"

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
