# Build a Windows NSIS installer from a pre-packaged Electron app directory (electron-builder --prepackaged).
param(
    [string]$BundleRoot = $(if ($env:WINDOWS_BUNDLE_DIR) { $env:WINDOWS_BUNDLE_DIR } else { 'windows-electron-bundle' }),
    [string]$ProjectDir = $(if ($env:NATIVE_AGENT_CONSOLE_DIR) { $env:NATIVE_AGENT_CONSOLE_DIR } else { 'apps/native-agent-console' })
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BundleRoot)) {
    if ($env:REQUIRE_INSTALLER_BUNDLE -eq '1') {
        throw "Bundle root '$BundleRoot' not found"
    }
    Write-Host "Bundle root '$BundleRoot' not found; skipping Windows installer build."
    exit 0
}

$exe = Get-ChildItem -Path $BundleRoot -Recurse -Filter 'native-agent-console.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1

if (-not $exe) {
    if ($env:REQUIRE_INSTALLER_BUNDLE -eq '1') {
        throw "No native-agent-console.exe under '$BundleRoot'"
    }
    Write-Host "No native-agent-console.exe under '$BundleRoot'; skipping Windows installer build."
    exit 0
}

$appDirectory = $exe.Directory.FullName
$packageJsonPath = Join-Path $appDirectory 'package.json'

if (Test-Path -LiteralPath $packageJsonPath) {
    # Install dir uses package.json name; artifactName uses version (electron-builder reads project package.json).
    $releaseVersion = $env:RELEASE_VERSION
    node -e @"
const fs = require('fs');
const path = process.argv[1];
const releaseVersion = process.argv[2] || '';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.name = 'Agenstra';
if (releaseVersion) {
  pkg.version = releaseVersion;
}
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"@ $packageJsonPath $releaseVersion
}

$configPath = Join-Path $ProjectDir 'electron-builder.installer.yml'

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "electron-builder config not found: $configPath"
}

$projectPackageJsonPath = Join-Path $ProjectDir 'package.json'
if ($env:RELEASE_VERSION -and (Test-Path -LiteralPath $projectPackageJsonPath)) {
    # electron-builder ${version} in artifactName comes from project package.json (not prepackaged).
    Write-Host "Using RELEASE_VERSION=$($env:RELEASE_VERSION) for installer artifact name."
    node -e @"
const fs = require('fs');
const pkgPath = process.argv[1];
const version = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"@ $projectPackageJsonPath $env:RELEASE_VERSION
}

Write-Host "Building NSIS installer from prepackaged app: $appDirectory"

# Pin version: matches apps/native-agent-console devDependency; avoids npx pulling latest (e.g. 26.x).
$electronBuilderVersion = '25.1.8'

Push-Location $ProjectDir
try {
    npx --yes "electron-builder@$electronBuilderVersion" --prepackaged $appDirectory --config electron-builder.installer.yml --win nsis --publish never
}
finally {
    Pop-Location
}

$installerOut = Join-Path $ProjectDir 'installer-out'
if (Test-Path -LiteralPath $installerOut) {
    Get-ChildItem -Path $installerOut -Recurse -File | ForEach-Object { Write-Host "Installer artifact: $($_.FullName)" }
}
