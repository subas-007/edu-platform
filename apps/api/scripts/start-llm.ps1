<#
.SYNOPSIS
  Starts the local colibri model server tuned for this app (OpenAI-compatible API on :8000).

.DESCRIPTION
  Qwen3.6-35B-A3B is a mixture-of-experts model: 22 GB on disk, of which only a slice is used
  per token. On a CPU-only machine, speed depends on how much of it stays in RAM and on how
  cheaply the CPU can multiply it. This launcher:

    * reserves a 16k-token context instead of 64k (this app's longest prompt is ~3k tokens);
    * gives colibri a fixed RAM budget (-RamGB) instead of whatever is free at start-up;
    * turns off "thinking" so no time is spent on hidden reasoning tokens;
    * keeps the experts in INT4 (they ship INT4-packed) and the dense trunk in INT8.

  Measured on this machine (i7-13620H, 32 GB, NVMe; flashcard call, 1,359-token prompt, warm):
      original `coli web --auto-tier` (64k ctx)    prompt 267 s | 1.5 tok/s | 10.7 min
      this launcher, -DenseBits 4 (INT4 trunk)    prompt 310 s | 4.3 tok/s |  7.8 min
      this launcher, -DenseBits 8 (default)       prompt 118 s | 5.3 tok/s |  3.7 min
  An INT4 trunk is slower here: the CPU has fast INT8 dot products (AVX-VNNI), while INT4
  must be unpacked before every multiply. It only pays off when RAM, not compute, is the limit.

  Re-measure after changing anything with:  npm run llm:bench

.EXAMPLE
  npm run llm:start
  powershell -File scripts/start-llm.ps1 -RamGB 20 -DenseBits 8
#>
param(
  [string]$Model = $(if ($env:COLIBRI_MODEL) { $env:COLIBRI_MODEL } else { Join-Path $env:USERPROFILE 'colibri-models\qwen36-35b' }),
  # RAM for colibri in GB. On the 32 GB dev machine ~14 GB is available with Docker, the
  # API/worker/web, VS Code and a browser running; 12 keeps Windows from paging.
  [int]$RamGB = 12,
  [int]$Context = 16384,
  # Dense-trunk precision: 8 = INT8 (fastest here), 4 = INT4 (half the trunk RAM, slower on this CPU),
  # 16 = FP16 (most exact, slowest). The experts stay INT4 either way.
  [ValidateSet(4, 8, 16)][int]$DenseBits = 8,
  [int]$Port = 8000,
  [switch]$Think
)
$ErrorActionPreference = 'Stop'

$runtime = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'colibri\runtime') -Directory -Filter 'colibri-v*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $runtime) { throw "colibri runtime not found under $env:LOCALAPPDATA\colibri\runtime (install colibri first)" }
if (-not (Test-Path (Join-Path $Model 'config.json'))) { throw "No colibri model at $Model (set -Model or COLIBRI_MODEL)" }

$python = (Get-Command py -ErrorAction SilentlyContinue).Source
$pythonArgs = @('-3')
if (-not $python) { $python = (Get-Command python -ErrorAction Stop).Source; $pythonArgs = @() }

$env:COLI_DENSE_BITS = "$DenseBits"
$coliArgs = @(
  (Join-Path $runtime.FullName 'coli'), 'web',
  '--model', $Model,
  '--host', '127.0.0.1', '--port', "$Port",
  '--auto-tier', '--ram', "$RamGB", '--ctx', "$Context",
  $(if ($Think) { '--think' } else { '--no-think' }),
  '--no-browser'
)
Write-Host "colibri $($runtime.Name): $Model"
Write-Host "  INT$DenseBits trunk + INT4 experts | RAM $RamGB GB | context $Context | thinking $(if ($Think) { 'on' } else { 'off' }) | http://127.0.0.1:$Port/v1"
& $python @pythonArgs @coliArgs
exit $LASTEXITCODE
