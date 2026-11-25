param([ValidateSet('Setup','Read','Check')][string]$Mode = 'Setup')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EraPowerVault {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Write(ref Credential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
}
'@
$target = 'Purnell-eraPower-Scheduler'
$local = Join-Path $PSScriptRoot 'pentana-export\.local'
if ($Mode -eq 'Setup') {
    $login = Get-Credential -Message 'Save your eraPower login for the three-hour scheduler'
    if (-not $login) { exit 1 }
    $blob = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($login.Password)
    try {
        $entry = New-Object EraPowerVault+Credential
        $entry.Type = 1
        $entry.TargetName = $target
        $entry.UserName = $login.UserName
        $entry.CredentialBlob = $blob
        $entry.CredentialBlobSize = $login.Password.Length * 2
        $entry.Persist = 2
        if (-not [EraPowerVault]::Write([ref]$entry, 0)) { throw 'Windows Credential Manager could not save the credential.' }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob) }
    $workstation = Read-Host 'eraPower workstation (press Enter to keep the login form default)'
    New-Item -ItemType Directory -Path $local -Force | Out-Null
    @{ workstation = $workstation } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $local 'login-config.json') -Encoding UTF8
    $blocked = Join-Path $local 'login-blocked.json'
    if (Test-Path -LiteralPath $blocked) { Remove-Item -LiteralPath $blocked }
    Write-Host 'eraPower login saved in Windows Credential Manager.'
} else {
    $pointer = [IntPtr]::Zero
    if (-not [EraPowerVault]::Read($target, 1, 0, [ref]$pointer)) {
        if ($Mode -eq 'Check') { Write-Output 'Credential saved: False'; exit 0 }
        throw 'eraPower credential missing. Run tools/erapower-credentials.ps1 -Mode Setup.'
    }
    try {
        if ($Mode -eq 'Check') { Write-Output 'Credential saved: True'; return }
        $entry = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][EraPowerVault+Credential])
        $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($entry.CredentialBlob, $entry.CredentialBlobSize / 2)
        @{ username = $entry.UserName; password = $secret } | ConvertTo-Json -Compress
    } finally {
        $secret = $null
        [EraPowerVault]::CredFree($pointer)
    }
}
