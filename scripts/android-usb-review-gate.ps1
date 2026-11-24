[CmdletBinding()]
param([string]$RunName = 'android-r12')
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid run name' }
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android/pediturno-servicios'
$versionMatches = [regex]::Matches((Get-Content (Join-Path $android 'app/build.gradle.kts') -Raw), '(?m)^\s*versionCode\s*=\s*(\d+)\s*$')
if ($versionMatches.Count -ne 1) { throw 'Android versionCode could not be determined unambiguously' }
$actualVersionCode = [int]$versionMatches[0].Groups[1].Value
$out = Join-Path $root 'output/android-reviews-20261027'
New-Item -ItemType Directory -Force $out | Out-Null
$log = Join-Path $out "$RunName.log"
if (Test-Path $log) { throw 'Evidence already exists; use a new run name' }
$prior = Get-Content (Join-Path $root 'output/android-implementation-20261026/android-copy-r11-source-start.json') -Raw | ConvertFrom-Json
$paths = @($prior.files | Where-Object { $_.path -notlike 'app/src/*' } | ForEach-Object { $_.path })
$paths += Get-ChildItem (Join-Path $android 'app/src') -File -Recurse | ForEach-Object { [IO.Path]::GetRelativePath($android, $_.FullName).Replace('\','/') }
$files = @($paths | Sort-Object -Unique | ForEach-Object {
    $item = Get-Item (Join-Path $android $_)
    [ordered]@{ path=$_; bytes=$item.Length; sha256=(Get-FileHash $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$bytes = [Text.Encoding]::UTF8.GetBytes(($files | ConvertTo-Json -Depth 4 -Compress))
$digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
$snapshotName = "$RunName-source.json"
@{at=[DateTime]::UtcNow.ToString('o');scope='USB debug local-only review';files=$files;digest=$digest} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out $snapshotName)
$env:JAVA_HOME = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:PATHEXT = '.COM;.EXE;.BAT;.CMD'
$code = 1
Push-Location $android
try {
    & cmd.exe /d /c 'gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest -PpediturnoDebugHost=127.0.0.1 --console=plain --no-daemon --no-configuration-cache --max-workers=2 -Dorg.gradle.jvmargs=-Xmx3072m -Pkotlin.compiler.execution.strategy=in-process' *> $log
    $code = $LASTEXITCODE
} finally { Pop-Location; Set-Content (Join-Path $out "$RunName.exit") $code }
if ($code -ne 0) { exit $code }
foreach ($entry in $files) {
    if ((Get-FileHash (Join-Path $android $entry.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Source changed during build' }
}
$totals = @{tests=0;failures=0;errors=0;skipped=0}
$suites = @(Get-ChildItem (Join-Path $android 'app/build/test-results/testDebugUnitTest') -Filter 'TEST-*.xml')
foreach ($suite in $suites) {
    [xml]$xml = Get-Content $suite.FullName -Raw
    foreach ($key in @('tests','failures','errors','skipped')) { $totals[$key] += [int]$xml.testsuite.$key }
}
if ($totals.tests -lt 56 -or $totals.failures -ne 0 -or $totals.errors -ne 0 -or $totals.skipped -ne 0) { throw 'Unit acceptance incomplete' }
$artifacts = @('app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk') | ForEach-Object {
    $file = Get-Item (Join-Path $android $_)
    @{name=$file.Name;bytes=$file.Length;sha256=(Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
@{at=[DateTime]::UtcNow.ToString('o');scope='usb-debug-local-fixtures';exit=0;versionCode=$actualVersionCode;sourceSnapshot=$snapshotName;sourceDigest=$digest;emulatorHost='127.0.0.1';useFirebaseEmulators=$true;allowProductionMutations=$false;unitResults=$totals;suites=$suites.Count;artifacts=$artifacts;log="$RunName.log"} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out "$RunName-manifest.json")
Write-Output ($totals | ConvertTo-Json -Compress)
