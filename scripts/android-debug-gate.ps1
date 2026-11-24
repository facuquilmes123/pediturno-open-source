[CmdletBinding()]
param([string]$RunName = 'android-final-gate-root')

$ErrorActionPreference = 'Stop'
# Managed child runtimes can inherit PATHEXT=.CPL. Restore executable lookup
# only in this build process; the user's system environment is not changed.
$env:PATHEXT = ".COM;.EXE;.BAT;.CMD;$env:PATHEXT"
if ($RunName -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid evidence run name.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$evidenceRoot = Join-Path $projectRoot 'output\android-implementation-20261026'
$logPath = Join-Path $evidenceRoot ($RunName + '.log')
$exitPath = Join-Path $evidenceRoot ($RunName + '.exit')
if ((Test-Path -LiteralPath $logPath) -or (Test-Path -LiteralPath $exitPath)) {
    throw 'Evidence already exists. Select a new run name; previous results are never overwritten.'
}
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'Configured JDK is unavailable.' }
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$gateExit = 1
Push-Location (Join-Path $projectRoot 'android\pediturno-servicios')
try {
    # Invoke the batch through cmd explicitly: some managed runtimes omit .BAT
    # from PATHEXT, so PowerShell otherwise treats it as a document in a pipe.
    $gradleCommand = 'gradlew.bat :app:compileDebugKotlin :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:compileDebugAndroidTestKotlin --no-daemon --no-configuration-cache --max-workers=2 --console=plain'
    & (Join-Path ([Environment]::SystemDirectory) 'cmd.exe') /d /c $gradleCommand *>&1 |
        Out-File -LiteralPath $logPath -Encoding utf8
    $gateExit = $LASTEXITCODE
} finally {
    Pop-Location
    Set-Content -LiteralPath $exitPath -Value $gateExit -NoNewline
}
exit $gateExit
