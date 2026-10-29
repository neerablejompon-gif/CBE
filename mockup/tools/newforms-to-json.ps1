# Read the new-format report forms ("New Form\แบบฟอร์มรายงานผล_<CODE>_รวมเกณฑ์และGAP_*.xlsx") into a dataset for one fiscal year.
# Output has the same shape as forms-to-json.ps1 (window.CBE_FORMS_<FY>), one tracked activity per level.
# Usage: powershell -File mockup\tools\newforms-to-json.ps1 -Dir "New Form" -Fy 2570 -Out mockup\data-2570.js
param($Dir, $Fy = 2570, $Out)
$ErrorActionPreference = 'Stop'
$MONTHS = 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'
function Clean([string]$s) { if (-not $s) { return '' }; ($s -replace 'การยางแห่งประเทศไทย', 'รัฐวิสาหกิจ' -replace 'กยท\.', 'องค์กร' -replace '\r', '').Trim() }
function Num($v) { $d = 0.0; if ($v -and [double]::TryParse("$v".Trim(), [ref]$d)) { return $d }; return $null }

function Read-Rows($x, $strs) {
  $rows = @{}
  foreach ($row in $x.worksheet.sheetData.row) {
    $h = @{}
    foreach ($c in $row.c) {
      if ($c.f) { continue }   # formulas carry no inputs
      $v = $c.v; if ($c.t -eq 's') { $v = $strs[[int]$v] } elseif ($c.t -eq 'inlineStr') { $v = $c.is.InnerText }
      if ($null -ne $v -and "$v" -ne '') { $h[($c.r -replace '\d', '')] = "$v" }
    }
    $rows[[int]$row.r] = $h
  }
  $rows
}

$result = [ordered]@{}
foreach ($file in Get-ChildItem -LiteralPath $Dir -Filter '*.xlsx') {
  if ($file.Name -notmatch '_([A-Z]+)_รวมเกณฑ์') { continue }
  $code = $Matches[1]
  $tmp = Join-Path $env:TEMP ('nf-' + [guid]::NewGuid()); New-Item -ItemType Directory $tmp | Out-Null
  Copy-Item -LiteralPath $file.FullName "$tmp\f.zip"; Expand-Archive "$tmp\f.zip" "$tmp\x"
  $ss = [xml][IO.File]::ReadAllText("$tmp\x\xl\sharedStrings.xml", [Text.Encoding]::UTF8)
  $strs = @($ss.sst.si | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
  $r1 = Read-Rows ([xml][IO.File]::ReadAllText("$tmp\x\xl\worksheets\sheet1.xml", [Text.Encoding]::UTF8)) $strs
  $r2 = Read-Rows ([xml][IO.File]::ReadAllText("$tmp\x\xl\worksheets\sheet2.xml", [Text.Encoding]::UTF8)) $strs
  Remove-Item $tmp -Recurse -Force
  $targets = @{}; foreach ($k in $r1.Keys) { if ($k -ge 13 -and $r1[$k].A -match '^\d') { $targets[$r1[$k].A] = Num $r1[$k].D } }
  $subs = @(); $sub = $null; $lv = $null
  foreach ($i in ($r2.Keys | Where-Object { $_ -ge 6 } | Sort-Object)) {
    $r = $r2[$i]
    if ($r.B -match '^(.*?)\s*\(น้ำหนัก ([\d.]+)\)') {
      $sub = [ordered]@{ code = $r.A; name = (Clean $Matches[1]); weight = [double]$Matches[2]; target = $targets[$r.A]; score = $null; levels = @() }
      $subs += $sub; $lv = $null; continue
    }
    if (-not $sub) { continue }
    if ($r.B -match '^ระดับ (\d)') {
      $plan = @($MONTHS | ForEach-Object { $n = Num $r[$_]; if ($null -eq $n) { 0 } else { $n } })
      $res = @($MONTHS | ForEach-Object { $n = Num $r2[$i + 1][$_]; if ($null -eq $n) { 0 } else { $n } })
      $tg = Num $r.D
      $lv = [ordered]@{ level = [int]$Matches[1]; criteria = (Clean $r.C); gap = (Clean $r.AA); narrative = (Clean $r.V); remark = ''; note = ''; mr = @()
        steps = @(if ($tg -or ($plan | Where-Object { $_ })) { [ordered]@{ name = "ดำเนินการตามค่าเกณฑ์ระดับ $($Matches[1])"; unit = $r.E; target = $tg; plan = $plan; result = $res } }) }
      $sub.levels += $lv
    }
    if ($lv -and $r.W) { $lv.mr += [ordered]@{ req = (Clean $r.W); has = ($r.X -eq '✓'); evidence = (Clean $r.Y) } }
  }
  $result[$code] = [ordered]@{ title = ''; owner = ''; target = $null; topics = @(); subs = $subs }
  "{0,-4} subs={1,3} levels={2,4}" -f $code, $subs.Count, (($subs | ForEach-Object { $_.levels.Count }) | Measure-Object -Sum).Sum
}
$json = $result | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($Out, "window.CBE_FORMS_$Fy=$json;", (New-Object Text.UTF8Encoding $false))
"wrote {0:N0} KB" -f ((Get-Item $Out).Length / 1KB)
