[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')]
    [string]$DeviceSerial = 'emulator-5554',
    [switch]$UsePrebuiltApks,
    [switch]$AllowPhysicalDevice,
    [string]$PrebuiltGateManifestPath
)

$ErrorActionPreference = 'Stop'
$env:PATHEXT = ".COM;.EXE;.BAT;.CMD;$env:PATHEXT"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not [string]::IsNullOrWhiteSpace($PrebuiltGateManifestPath)) {
    # Resolve before Push-Location changes the working directory to Android.
    $PrebuiltGateManifestPath = (Resolve-Path -LiteralPath $PrebuiltGateManifestPath).Path
}
$androidRoot = Join-Path $projectRoot 'android\pediturno-servicios'
$fixtureScript = Join-Path $PSScriptRoot 'android-native-e2e-fixtures.cjs'
$metadataPath = Join-Path $projectRoot 'output\android-native-e2e\fixture-metadata.json'
$evidenceDirectory = Join-Path $projectRoot 'output\android-implementation-20261026'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runStartedUtc = [DateTime]::UtcNow
$logPath = Join-Path $evidenceDirectory "android-native-e2e-$runId.log"
$exitPath = Join-Path $evidenceDirectory "android-native-e2e-$runId.exit"
$rawLogPath = Join-Path $env:TEMP "pediturno-native-e2e-$runId.raw.log"
$redactions = @()
$ownedReversePorts = @()
$physicalDevice = $DeviceSerial -notin @('emulator-5554', 'emulator-5556')
if ($physicalDevice -and (-not $AllowPhysicalDevice -or -not $UsePrebuiltApks -or [string]::IsNullOrWhiteSpace($PrebuiltGateManifestPath))) {
    throw 'Physical QA requires explicit authorization, prebuilt APKs and a successful USB debug gate manifest.'
}

# The fixture script independently rejects every non-loopback/non-demo target.
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIREBASE_PROJECT_ID = 'demo-pediturno-audit'
$env:GCLOUD_PROJECT = 'demo-pediturno-audit'
# Run the fixture once on the selected API 30 emulator. A 16 KB device is
# validated in a separate pass; connected tests must not mutate one fixture on
# multiple devices concurrently.
$env:ANDROID_SERIAL = $DeviceSerial
$adbPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'

function Invoke-LocalAdb([string[]]$AdbArguments, [int]$TimeoutSeconds = 30) {
    $adbInfo = [Diagnostics.ProcessStartInfo]::new($adbPath)
    $adbInfo.UseShellExecute = $false
    $adbInfo.CreateNoWindow = $true
    $adbInfo.RedirectStandardOutput = $true
    $adbInfo.RedirectStandardError = $true
    foreach ($adbArgument in @('-s', $env:ANDROID_SERIAL) + $AdbArguments) { $adbInfo.ArgumentList.Add($adbArgument) }
    $adbProcess = [Diagnostics.Process]::Start($adbInfo)
    try {
        $adbOutput = $adbProcess.StandardOutput.ReadToEndAsync()
        $adbError = $adbProcess.StandardError.ReadToEndAsync()
        if (-not $adbProcess.WaitForExit($TimeoutSeconds * 1000)) {
            $adbProcess.Kill()
            throw "Owned emulator ADB command timed out after ${TimeoutSeconds}s; no functional acceptance."
        }
        $adbText = $adbOutput.GetAwaiter().GetResult() + $adbError.GetAwaiter().GetResult()
        if ($adbProcess.ExitCode -ne 0) { throw "Owned emulator ADB command failed with code $($adbProcess.ExitCode)." }
        return $adbText
    } finally { $adbProcess.Dispose() }
}

New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
$testExit = 1
$fixtureSeeded = $false
$instrumentationStarted = $false
try {
    if (-not (Test-Path -LiteralPath $adbPath)) { throw 'Android platform-tools are required for native E2E.' }
    if ($physicalDevice) {
        if ((Invoke-LocalAdb @('get-state')).Trim() -ne 'device' -or
            (Invoke-LocalAdb @('shell', 'getprop', 'ro.kernel.qemu')).Trim() -eq '1') {
            throw 'Authorized physical device is not ready; no fixtures were seeded.'
        }
        $usbGate = Get-Content -LiteralPath $PrebuiltGateManifestPath -Raw | ConvertFrom-Json
        if ($usbGate.scope -ne 'usb-debug-local-fixtures' -or $usbGate.exit -ne 0 -or $usbGate.emulatorHost -ne '127.0.0.1' -or
            $usbGate.useFirebaseEmulators -ne $true -or $usbGate.allowProductionMutations -ne $false -or
            [IO.Path]::GetFileName([string]$usbGate.sourceSnapshot) -cne [string]$usbGate.sourceSnapshot) {
            throw 'USB debug gate does not prove the required local-only build.'
        }
        foreach ($port in @(3000, 9099, 9199)) {
            $reverseList = Invoke-LocalAdb @('reverse', '--list')
            $mapping = [regex]::Match($reverseList, "(?m)^\S+\s+tcp:$port\s+(\S+)\s*$")
            if ($mapping.Success -and $mapping.Groups[1].Value -ne "tcp:$port") {
                throw "Device reverse port $port already belongs to another mapping; no override."
            }
            if (-not $mapping.Success) {
                Invoke-LocalAdb @('reverse', "tcp:$port", "tcp:$port") | Out-Null
                $ownedReversePorts += $port
            }
        }
    }
    # Start the test Activity from the launcher rather than a stale system/IME
    # settings window. Do not stop the input method used by the user flow.
    $bootCompleted = Invoke-LocalAdb @('shell', 'getprop', 'sys.boot_completed')
    if ($bootCompleted.Trim() -ne '1') { throw 'Owned emulator has not completed boot; no fixtures were seeded.' }
    Invoke-LocalAdb @('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP') | Out-Null
    Invoke-LocalAdb @('shell', 'wm', 'dismiss-keyguard') | Out-Null
    Invoke-LocalAdb @('shell', 'input', 'keyevent', 'KEYCODE_HOME') | Out-Null
    & node $fixtureScript seed
    if ($LASTEXITCODE -ne 0) { throw 'Local Android fixture seeding failed.' }
    $fixtureSeeded = $true

    $fixture = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ($fixture.projectId -ne 'demo-pediturno-audit' -or $fixture.owners.Count -ne 2) {
        throw 'Fixture metadata is not the expected local Android E2E schema.'
    }
    $ownerA = $fixture.owners[0]
    $ownerB = $fixture.owners[1]
    $redactions = @($ownerA.email, $ownerA.password, $ownerB.email, $ownerB.password) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $env:PEDITURNO_E2E_FIXTURE_DATE = $fixture.dateKey
    $env:PEDITURNO_E2E_OWNER_A_EMAIL = $ownerA.email
    $env:PEDITURNO_E2E_OWNER_A_PASSWORD = $ownerA.password
    $env:PEDITURNO_E2E_OWNER_A_SERVICE_ID = $ownerA.serviceId
    $env:PEDITURNO_E2E_OWNER_B_EMAIL = $ownerB.email
    $env:PEDITURNO_E2E_OWNER_B_PASSWORD = $ownerB.password
    $env:PEDITURNO_E2E_OWNER_B_SERVICE_ID = $ownerB.serviceId

    Push-Location $androidRoot
    try {
        # Do not echo the command: Gradle receives the ephemeral credentials only
        # as environment-backed runner arguments. Its raw output stays in a
        # temporary file, then a redacted copy is written as durable evidence.
        # --no-daemon guarantees this short-lived process reads the newly set
        # local fixture environment instead of inheriting a stale Gradle daemon.
        # Keep the incremental test compiler in the short-lived Gradle JVM on
        # low-memory hosts instead of retaining an additional compiler daemon.
        if ($UsePrebuiltApks) {
            # Reuse the exact sources from the successful signed gate. This mode
            # avoids retaining Gradle/Kotlin JVMs beside the emulator during QA.
            $snapshotPath = if ($physicalDevice) { Join-Path (Split-Path -Parent $PrebuiltGateManifestPath) $usbGate.sourceSnapshot } else { Join-Path $evidenceDirectory 'android-release-source-snapshot.json' }
            $sourceSnapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
            if ($physicalDevice -and $sourceSnapshot.digest -ne $usbGate.sourceDigest) { throw 'USB gate source binding changed.' }
            foreach ($sourceEntry in $sourceSnapshot.files) {
                $sourceFile = Join-Path $androidRoot $sourceEntry.path
                if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -ne $sourceEntry.sha256) { throw 'Prebuilt APK source snapshot changed; rebuild before testing.' }
            }
            $expectedSourceCount = @($sourceSnapshot.files | Where-Object { $_.path.StartsWith('app/src/') }).Count
            if (@(Get-ChildItem -LiteralPath (Join-Path $androidRoot 'app\src') -Recurse -File).Count -ne $expectedSourceCount) { throw 'Android source inventory changed; rebuild before testing.' }
            $debugApk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
            $testApk = Join-Path $androidRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
            $prebuiltHashes = @($debugApk, $testApk) | ForEach-Object { @{name=[IO.Path]::GetFileName($_);sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash} }
            if ($physicalDevice) {
                foreach ($artifact in $prebuiltHashes) {
                    $expected = @($usbGate.artifacts | Where-Object name -eq $artifact.name)
                    if ($expected.Count -ne 1 -or $expected[0].sha256 -ne $artifact.sha256) { throw 'USB APK bytes differ from the successful gate.' }
                }
            }
            Invoke-LocalAdb @('install', '-r', $debugApk) 120 | Out-Null
            Invoke-LocalAdb @('install', '-r', $testApk) 120 | Out-Null
            $registered = Invoke-LocalAdb @('shell', 'pm', 'list', 'instrumentation')
            $runnerMatches = [regex]::Matches($registered, 'instrumentation:(com\.pediturno\.servicios\.debug\.test/[A-Za-z0-9._]+)\s+\(target=com\.pediturno\.servicios\.debug\)')
            if ($runnerMatches.Count -ne 1 -or -not $runnerMatches[0].Groups[1].Value.EndsWith('/androidx.test.runner.AndroidJUnitRunner')) { throw 'Expected local instrumentation registration not found.' }
            $runnerComponent = $runnerMatches[0].Groups[1].Value
            $runnerValues = [ordered]@{class='com.pediturno.servicios.NativeWorkspaceE2eTest';fixtureDate=$fixture.dateKey;ownerAEmail=$ownerA.email;ownerAPassword=$ownerA.password;ownerAServiceId=$ownerA.serviceId;ownerBEmail=$ownerB.email;ownerBPassword=$ownerB.password;ownerBServiceId=$ownerB.serviceId}
            function ConvertTo-AndroidShellArgument([string]$Value) {
                # POSIX shell quoting, including a literal single quote. No eval.
                return "'" + $Value.Replace("'", "'" + '"' + "'" + '"' + "'") + "'"
            }
            $shellParts = @('am', 'instrument', '-w', '-r')
            foreach ($runnerKey in $runnerValues.Keys) { $shellParts += @('-e', (ConvertTo-AndroidShellArgument $runnerKey), (ConvertTo-AndroidShellArgument ([string]$runnerValues[$runnerKey]))) }
            $shellParts += ConvertTo-AndroidShellArgument $runnerComponent
            $instrumentInfo = [Diagnostics.ProcessStartInfo]::new($adbPath)
            $instrumentInfo.UseShellExecute=$false; $instrumentInfo.CreateNoWindow=$true
            $instrumentInfo.RedirectStandardInput=$true; $instrumentInfo.RedirectStandardOutput=$true; $instrumentInfo.RedirectStandardError=$true
            foreach ($instrumentArg in @('-s', $env:ANDROID_SERIAL, 'shell', '-T')) { $instrumentInfo.ArgumentList.Add($instrumentArg) }
            $instrumentationStarted = $true
            $instrumentProcess = [Diagnostics.Process]::Start($instrumentInfo)
            try {
                $instrumentOut = $instrumentProcess.StandardOutput.ReadToEndAsync()
                $instrumentErr = $instrumentProcess.StandardError.ReadToEndAsync()
                # Fixture credentials travel on stdin, never in host command lines.
                $instrumentProcess.StandardInput.WriteLine(($shellParts -join ' '))
                $instrumentProcess.StandardInput.Close()
                $instrumentTimedOut = -not $instrumentProcess.WaitForExit(360000)
                if ($instrumentTimedOut) { $instrumentProcess.Kill(); $instrumentProcess.WaitForExit() }
                $instrumentText = $instrumentOut.GetAwaiter().GetResult() + $instrumentErr.GetAwaiter().GetResult()
                Set-Content -LiteralPath $rawLogPath -Value $instrumentText -Encoding utf8
                $passedStatuses = [regex]::Matches($instrumentText, '(?m)^INSTRUMENTATION_STATUS_CODE:\s*0\s*$').Count
                $testExit = if (-not $instrumentTimedOut -and $instrumentProcess.ExitCode -eq 0 -and $passedStatuses -eq 1 -and $instrumentText -match '(?m)^\s*OK \(1 test\)\s*$' -and $instrumentText -match '(?m)^INSTRUMENTATION_CODE:\s*-1\s*$' -and $instrumentText -notmatch '(?m)^INSTRUMENTATION_STATUS_CODE:\s*-[1-4]\s*$') { 0 } else { 1 }
                @{mode='prebuilt-adb';serial=$env:ANDROID_SERIAL;nativeExit=$instrumentProcess.ExitCode;timedOut=$instrumentTimedOut;expectedTests=1;passedStatuses=$passedStatuses;testExit=$testExit;sourceDigest=$sourceSnapshot.digest;artifacts=$prebuiltHashes} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDirectory "android-prebuilt-e2e-$runId.json")
            } finally { $instrumentProcess.Dispose() }
        } else {
        $instrumentationStarted = $true
        & (Join-Path ([Environment]::SystemDirectory) 'cmd.exe') /d /c 'gradlew.bat :app:connectedDebugAndroidTest --console=plain --no-daemon --no-configuration-cache --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process' *>&1 | Out-File -LiteralPath $rawLogPath -Encoding utf8
        $testExit = $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} finally {
    if (Test-Path -LiteralPath $rawLogPath) {
        $safeLog = Get-Content -LiteralPath $rawLogPath -Raw
        foreach ($secret in $redactions) {
            $safeLog = $safeLog.Replace($secret, '[REDACTED]')
        }
        Set-Content -LiteralPath $logPath -Value $safeLog -Encoding utf8
        Remove-Item -LiteralPath $rawLogPath -Force
    }
    # Preserve redacted JUnit evidence before the next Gradle run replaces it.
    $junitRoot = Join-Path $androidRoot "app\build\outputs\androidTest-results\connected\debug"
    if ($instrumentationStarted -and -not $UsePrebuiltApks -and (Test-Path -LiteralPath $junitRoot)) {
        $junitEvidence = Join-Path $evidenceDirectory ("android-junit-$runId")
        New-Item -ItemType Directory -Force -Path $junitEvidence | Out-Null
        Get-ChildItem -LiteralPath $junitRoot -Filter "*.xml" -File -Recurse | Where-Object { $_.LastWriteTimeUtc -ge $runStartedUtc } | ForEach-Object {
            $safeXml = Get-Content -LiteralPath $_.FullName -Raw
            foreach ($secret in $redactions) { $safeXml = $safeXml.Replace($secret, "[REDACTED]") }
            Set-Content -LiteralPath (Join-Path $junitEvidence $_.Name) -Value $safeXml -Encoding utf8
        }
    }
    if ($testExit -eq 0) {
        & node $fixtureScript verify-workspace *>&1 | Add-Content -LiteralPath $logPath -Encoding utf8
        if ($LASTEXITCODE -ne 0) { $testExit = $LASTEXITCODE }
    }
    if ($UsePrebuiltApks -and $instrumentationStarted -and $testExit -ne 0) {
        # Stop only this disposable debug target before deleting its fixtures,
        # including when the host ADB shell reached its time limit.
        try { Invoke-LocalAdb @('shell', 'am', 'force-stop', 'com.pediturno.servicios.debug') 15 | Out-Null }
        catch { 'Owned debug target stop could not be confirmed.' | Add-Content -LiteralPath $logPath -Encoding utf8 }
    }
    if ($testExit -ne 0 -and $fixtureSeeded) {
        $capturePath = Join-Path $evidenceDirectory ("android-e2e-evidence-$runId")
        New-Item -ItemType Directory -Force -Path $capturePath | Out-Null
        $adbPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Android\Sdk\platform-tools\adb.exe'
        $captureId = [regex]::Replace([string]$ownerA.serviceId, "[^A-Za-z0-9]", "")
        if ($captureId.Length -gt 40) { $captureId = $captureId.Substring(0, 40) }
        if ([string]::IsNullOrEmpty($captureId)) { $captureId = "fixture" }
        $remoteCapture = "/data/local/tmp/pediturno-native-e2e-$captureId.png"
        try { Invoke-LocalAdb @('pull', $remoteCapture, (Join-Path $capturePath 'failure-before-teardown.png')) 15 |
            Add-Content -LiteralPath $logPath -Encoding utf8 }
        catch { 'Pre-teardown capture unavailable from owned emulator.' | Add-Content -LiteralPath $logPath -Encoding utf8 }
    }
    if ($fixtureSeeded) {
        & node $fixtureScript cleanup
        if ($LASTEXITCODE -ne 0 -and $testExit -eq 0) { $testExit = $LASTEXITCODE }
    }
    foreach ($port in $ownedReversePorts) {
        try {
            $reverseList = Invoke-LocalAdb @('reverse', '--list') 10
            if ($reverseList -match "(?m)^\S+\s+tcp:$port\s+tcp:$port\s*$") {
                Invoke-LocalAdb @('reverse', '--remove', "tcp:$port") 10 | Out-Null
            }
        } catch { "Owned USB reverse port $port cleanup could not be confirmed." | Add-Content -LiteralPath $logPath -Encoding utf8 }
    }
    'PEDITURNO_E2E_FIXTURE_DATE', 'PEDITURNO_E2E_OWNER_A_EMAIL', 'PEDITURNO_E2E_OWNER_A_PASSWORD',
    'PEDITURNO_E2E_OWNER_A_SERVICE_ID', 'PEDITURNO_E2E_OWNER_B_EMAIL', 'PEDITURNO_E2E_OWNER_B_PASSWORD',
    'PEDITURNO_E2E_OWNER_B_SERVICE_ID' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
    Set-Content -LiteralPath $exitPath -Value $testExit -NoNewline
}

exit $testExit
