[CmdletBinding()]
param(
    [switch]$Initialize,
    [string[]]$Tasks = @(':app:assembleRelease', ':app:bundleRelease'),
    [ValidateRange(1024, 4096)][int]$MaxHeapMiB = 2048
)

$ErrorActionPreference = 'Stop'
$env:PATHEXT = ".COM;.EXE;.BAT;.CMD;$env:PATHEXT"
if (-not $IsWindows) { throw 'This helper uses Windows DPAPI. Supply signing environment variables through your secure CI store on other hosts.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signingRoot = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PediTurno\Signing'))
# Packaged Codex virtualizes LocalAppData writes. A later external shell can see
# the original vault under LocalCache instead of the normal LocalAppData path.
# Reuse a single complete existing vault; never initialize or replace a key here.
if (-not (Test-Path -LiteralPath $signingRoot)) {
    $packageRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Packages'
    $existingVaults = @(Get-ChildItem -LiteralPath $packageRoot -Directory -Filter 'OpenAI.Codex_*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\PediTurno\Signing' } |
        Where-Object { (Test-Path -LiteralPath (Join-Path $_ 'pediturno-upload.p12')) -and (Test-Path -LiteralPath (Join-Path $_ 'signing-secrets.dpapi')) })
    if ($existingVaults.Count -gt 1) { throw 'Multiple packaged signing vaults found. Verify their certificates before selecting one.' }
    if ($existingVaults.Count -eq 1) {
        $signingRoot = [IO.Path]::GetFullPath($existingVaults[0])
        Write-Output 'Using the existing protected signing vault in the packaged Codex profile.'
    }
}
$storePath = Join-Path $signingRoot 'pediturno-upload.p12'
$secretPath = Join-Path $signingRoot 'signing-secrets.dpapi'
$metadataPath = Join-Path $signingRoot 'signing-public.json'
$javaRoot = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
if (-not (Test-Path -LiteralPath (Join-Path $javaRoot 'bin\keytool.exe'))) { throw 'Configured JDK is unavailable; select the installed JDK before signing.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData

function New-PrivateSigningDirectory {
    [IO.Directory]::CreateDirectory($signingRoot) | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $signingRoot -AclObject $acl
}

if (-not (Test-Path -LiteralPath $secretPath) -or -not (Test-Path -LiteralPath $storePath)) {
    if (-not $Initialize) { throw 'Upload signing is not initialized. Run this helper with -Initialize first.' }
    if ((Test-Path -LiteralPath $secretPath) -or (Test-Path -LiteralPath $storePath)) {
        throw 'Partial signing state found. Preserve it and recover the missing file; this helper never replaces an upload key.'
    }
    New-PrivateSigningDirectory
    $passwordBytes = [byte[]]::new(36)
    [Security.Cryptography.RandomNumberGenerator]::Fill($passwordBytes)
    $password = [Convert]::ToBase64String($passwordBytes)
    $secret = @{ storePassword = $password; keyPassword = $password; keyAlias = 'pediturno-upload' }
    $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes(($secret | ConvertTo-Json -Compress)), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    # Persist protected recovery material before generating the key; never store plaintext passwords.
    [IO.File]::WriteAllBytes($secretPath, $protected)
    $keygen = [Diagnostics.ProcessStartInfo]::new((Join-Path $javaRoot 'bin\keytool.exe'))
    $keygen.UseShellExecute = $false
    $keygen.CreateNoWindow = $true
    $keygen.RedirectStandardOutput = $true
    $keygen.RedirectStandardError = $true
    $keygen.Environment['PEDITURNO_KEYGEN_PASS'] = $password
    foreach ($argument in @('-genkeypair', '-keystore', $storePath, '-storetype', 'PKCS12', '-alias', 'pediturno-upload', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=PediTurno,OU=Android,O=Belgrano Apps,C=AR', '-storepass:env', 'PEDITURNO_KEYGEN_PASS', '-keypass:env', 'PEDITURNO_KEYGEN_PASS', '-noprompt')) { $keygen.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($keygen)
    $null = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Upload key generation failed; protected recovery material was preserved. No secret was logged.' }
    @{ packageName = 'com.pediturno.servicios'; alias = 'pediturno-upload'; storeType = 'PKCS12'; storePath = $storePath; secretProtection = 'Windows DPAPI CurrentUser'; createdAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
    $password = $null
    $secret = $null
    Write-Output 'PediTurno upload signing initialized outside the repository with encrypted local credentials.'
}
$secretBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secretPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$credentials = [Text.Encoding]::UTF8.GetString($secretBytes) | ConvertFrom-Json
try {
    $certificatePath = Join-Path $signingRoot 'upload-certificate.pem'
    if (-not (Test-Path -LiteralPath $certificatePath)) {
        $export = [Diagnostics.ProcessStartInfo]::new((Join-Path $javaRoot 'bin\keytool.exe'))
        $export.UseShellExecute = $false
        $export.CreateNoWindow = $true
        $export.RedirectStandardOutput = $true
        $export.RedirectStandardError = $true
        $export.Environment['PEDITURNO_CERT_PASS'] = $credentials.storePassword
        foreach ($argument in @('-exportcert', '-rfc', '-keystore', $storePath, '-storetype', 'PKCS12', '-alias', $credentials.keyAlias, '-storepass:env', 'PEDITURNO_CERT_PASS', '-file', $certificatePath)) { $export.ArgumentList.Add($argument) }
        $certificateProcess = [Diagnostics.Process]::Start($export)
        $null = $certificateProcess.StandardOutput.ReadToEnd()
        $null = $certificateProcess.StandardError.ReadToEnd()
        $certificateProcess.WaitForExit()
        if ($certificateProcess.ExitCode -ne 0) { throw 'Public signing certificate export failed. The upload key was preserved.' }
    }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([IO.File]::ReadAllText($certificatePath))
    $publicInfo = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json -AsHashtable
    $publicInfo.certificateSha1 = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA1)
    $publicInfo.certificateSha256 = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256)
    $publicInfo.certificatePath = $certificatePath
    $publicInfo | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
    if ($Initialize) { Write-Output 'Public upload certificate and fingerprints are available in signing-public.json.'; return }
    $build = [Diagnostics.ProcessStartInfo]::new('cmd.exe')
    $build.UseShellExecute = $false
    $build.CreateNoWindow = $true
    $build.RedirectStandardOutput = $true
    $build.RedirectStandardError = $true
    $build.WorkingDirectory = Join-Path $projectRoot 'android\pediturno-servicios'
    # Tasks are restricted to Gradle task identifiers, never interpolated arbitrary shell code.
    foreach ($task in $Tasks) { if ($task -notmatch '^:?[A-Za-z][A-Za-z0-9:_-]*$') { throw 'Invalid Gradle task identifier.' } }
    $build.ArgumentList.Add('/d')
    $build.ArgumentList.Add('/c')
    $build.ArgumentList.Add('gradlew.bat ' + ($Tasks -join ' ') + " --no-daemon --no-configuration-cache --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process -Dorg.gradle.jvmargs=-Xmx${MaxHeapMiB}m --console=plain")
    $build.Environment['JAVA_HOME'] = $javaRoot
    $build.Environment['PEDITURNO_UPLOAD_STORE_FILE'] = $storePath
    $build.Environment['PEDITURNO_UPLOAD_STORE_PASSWORD'] = $credentials.storePassword
    $build.Environment['PEDITURNO_UPLOAD_KEY_PASSWORD'] = $credentials.keyPassword
    $build.Environment['PEDITURNO_UPLOAD_KEY_ALIAS'] = $credentials.keyAlias
    $process = [Diagnostics.Process]::Start($build)
    # Forward both native streams asynchronously; a hidden Windows child must
    # not depend on an inherited console to preserve complete build evidence.
    $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $stderrCopy = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    $process.WaitForExit()
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutCopy, $stderrCopy))
    exit $process.ExitCode
} finally {
    [Array]::Clear($secretBytes, 0, $secretBytes.Length)
    $credentials = $null
}
