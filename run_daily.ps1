# Jutarnje ažuriranje Euro rezultata (pokreće Task Scheduler)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"
python -P fetch.py update *>> (Join-Path $PSScriptRoot "update.log")
