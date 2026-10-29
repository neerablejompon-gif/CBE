# Convert the old per-indicator report forms (Old Form\*.xlsx) + SE-AM 2569 structure into mockup/data.js
# Usage: powershell -File mockup\tools\forms-to-json.ps1 -Forms "Old Form" -Seed "<repo>\src\Seed.gs" -Out mockup\data.js
# -KeepNames keeps organisation and people names (for internal files such as the new Excel forms; never for the published mockup)
param($Forms, $Seed, $Out, [switch]$KeepNames)
$ErrorActionPreference = 'Stop'
$MONTHS = 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'
$FILES = @{ 'CG' = 'CG 2569'; 'SP' = '_SP_'; 'RM' = 'RM 2569'; 'SM' = 'SM 2569'; 'CM' = 'CM  2569'; 'DT' = '_DT_'; 'IT' = 'IT 2569'; 'HCM' = 'HCM 2569'; 'KM' = 'KM 2569'; 'IM' = 'IM 2569'; 'IA' = 'IA 2569' }

function Clean([string]$s) {
  if (-not $s) { return '' }
  if (-not $KeepNames) { $s = $s -replace 'การยางแห่งประเทศไทย', 'รัฐวิสาหกิจ' -replace 'กยท\.', 'องค์กร' }
  $s = $s -replace '\r', ''
  return $s.Trim()
}
function G($r, $col, $k) { if ($col[$k]) { return $r[$col[$k]] }; return $null }
function Num($v) { $d = 0.0; if ($v -and [double]::TryParse("$v".Trim(), [ref]$d)) { return $d }; return $null }

function Read-Sheet($xlsx) {
  $tmp = Join-Path $env:TEMP ('cbe-' + [guid]::NewGuid())
  New-Item -ItemType Directory $tmp | Out-Null
  Copy-Item -LiteralPath $xlsx "$tmp\f.zip"
  Expand-Archive "$tmp\f.zip" "$tmp\x"
  $strs = @()
  if (Test-Path "$tmp\x\xl\sharedStrings.xml") {
    $ss = [xml](Get-Content "$tmp\x\xl\sharedStrings.xml" -Raw -Encoding UTF8)
    $strs = @($ss.sst.si | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
  }
  $x = [xml](Get-Content "$tmp\x\xl\worksheets\sheet1.xml" -Raw -Encoding UTF8)
  $rows = New-Object System.Collections.ArrayList
  foreach ($row in $x.worksheet.sheetData.row) {
    $h = @{}
    foreach ($c in $row.c) {
      $v = $c.v; if ($c.t -eq 's') { $v = $strs[[int]$v] } elseif ($c.t -eq 'inlineStr') { $v = $c.is.InnerText }
      if ($null -ne $v -and "$v".Trim() -ne '') { $h[($c.r -replace '\d', '')] = "$v" }
    }
    [void]$rows.Add($h)
  }
  Remove-Item $tmp -Recurse -Force
  return , $rows
}

function Parse-Form($xlsx) {
  $rows = Read-Sheet $xlsx
  $info = [ordered]@{ title = ''; owner = ''; target = $null; topics = @(); subs = @() }
  $hi = -1
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $r = $rows[$i]
    if ($i -lt 8) {
      if ($r.A -and -not $info.title) { $info.title = Clean $r.A }
      $vals = @($r.Values)
      if (($vals -join ' ') -match 'ผู้รับผิดชอบ') { $info.owner = Clean ($vals | Where-Object { $_ -notmatch 'ผู้รับผิดชอบ' } | Select-Object -First 1) }
      foreach ($k in $r.Keys) { if ($r[$k] -match 'คะแนนเป้าหมาย') { foreach ($k2 in $r.Keys) { $n = Num $r[$k2]; if ($null -ne $n -and $n -gt 0 -and $n -le 5) { $info.target = $n } } } }
    }
    if (($r.B -as [string]).Trim() -eq 'ระดับ') { $hi = $i; break }
  }
  if ($hi -lt 0) { throw "no header row in $xlsx" }
  $col = @{}
  foreach ($k in $rows[$hi].Keys) {
    $t = $rows[$hi][$k]
    $key = switch -Regex ($t) {
      '^ลำดับ' { 'code'; break } '^ระดับ' { 'lv'; break } 'ค่าเกณฑ์' { 'crit'; break } 'GAP' { 'gap'; break } 'ขั้นตอน' { 'step'; break }
      'ถ่วง|ความก้าวหน้า|กำหนดระยะ' { $null; break } 'น้ำหนัก' { 'w'; break } 'เป้าหมาย' { 'tgt'; break } 'หน่วยนับ' { 'unit'; break } 'แผนผล' { 'pr'; break }
      'ปัจจุบัน|ปัจุบัน' { 'score'; break } 'รายละเอียดผล' { 'narr'; break } 'ชื่อหลักฐาน' { 'ev'; break }
      'Minimum|Mininum|หลักฐานประกอบผล' { 'mr'; break } 'ติ๊กถูก|ความครบถ้วน' { 'tick'; break } 'ข้อสังเกต' { 'rmk'; break } 'คำอธิบายเพิ่มเติม' { 'note'; break }
      default { $null }
    }
    if ($key -and -not $col[$key]) { $col[$key] = $k }
  }
  $mcol = @{}
  foreach ($k in $rows[$hi + 1].Keys) { $ix = [array]::IndexOf($MONTHS, $rows[$hi + 1][$k].Trim()); if ($ix -ge 0) { $mcol[$k] = $ix } }
  $sub = $null; $lv = $null; $step = $null
  for ($i = $hi + 2; $i -lt $rows.Count; $i++) {
    $r = $rows[$i]
    $code = if ($col.code) { "$((G $r $col 'code'))".Trim() } else { '' }
    $lvText = if ($col.lv) { "$((G $r $col 'lv'))".Trim() } else { '' }
    if ($code -match '^\d+(\.\d+)*$') {
      $n = Num $code
      if ($code -match '^\d+(\.0+)?$') {
        $info.topics += [ordered]@{ no = [string][int]$n; name = (Clean $lvText); weight = (Num (G $r $col 'w')) }
        $sub = $null; $lv = $null; continue
      }
      if ($code -match '^\d+\.\d+$') { $code = ([math]::Round($n, 2)).ToString() }
      $sub = [ordered]@{ code = $code; name = (Clean $lvText); weight = (Num (G $r $col 'w')); target = (Num (G $r $col 'tgt')); score = (Num (G $r $col 'score')); levels = @() }
      $info.subs += $sub; $lv = $null; continue
    }
    if (-not $sub) { continue }
    if ($lvText -match '^ระดับ\s*(\d)') {
      $lv = [ordered]@{ level = [int]$Matches[1]; criteria = (Clean (G $r $col 'crit')); gap = (Clean (G $r $col 'gap')); steps = @(); narrative = ''; mr = @(); remark = ''; note = '' }
      $sub.levels += $lv; $step = $null
    }
    if (-not $lv) { continue }
    $pr = if ($col.pr) { "$((G $r $col 'pr'))".Trim() } else { '' }
    if ($pr -eq 'แผน') {
      $plan = @(0) * 12; foreach ($k in $mcol.Keys) { $v = Num $r[$k]; if ($v) { $plan[$mcol[$k]] = $v } }
      $name = Clean (G $r $col 'step'); if (-not $name) { $name = 'ดำเนินการตามค่าเกณฑ์ระดับ ' + $lv.level }
      $step = [ordered]@{ name = $name; unit = (Clean (G $r $col 'unit')); target = (Num (G $r $col 'tgt')); plan = $plan; result = @(0) * 12 }
      $lv.steps += $step
    } elseif ($pr -eq 'ผล' -and $step) {
      foreach ($k in $mcol.Keys) { $v = Num $r[$k]; if ($v) { $step.result[$mcol[$k]] = $v } }
    }
    foreach ($f in 'narr', 'rmk', 'note') {
      if ($col[$f]) { $t = Clean $r[$col[$f]]; if ($t) { $key = @{ narr = 'narrative'; rmk = 'remark'; note = 'note' }[$f]; $lv[$key] = (($lv[$key], $t) | Where-Object { $_ }) -join "`n" } }
    }
    $req = if ($col.mr) { Clean (G $r $col 'mr') } else { '' }
    $ev = if ($col.ev) { Clean (G $r $col 'ev') } else { '' }
    $tick = if ($col.tick) { "$((G $r $col 'tick'))".Trim() } else { '' }
    $has = $tick -match '^(1|1\.0|✓|/|TRUE|ครบ)$'
    if ($req) { $lv.mr += [ordered]@{ req = $req; has = $has; evidence = $ev } }
    elseif ($ev -and $lv.mr.Count) { $last = $lv.mr[$lv.mr.Count - 1]; if (-not $last.evidence) { $last.evidence = $ev } else { $last.evidence += "`n" + $ev } }
  }
  if ($info.owner -match '^[\d.]+$|^หัวข้อ$' -or (-not $KeepNames -and $info.owner -match 'นาย|นาง')) { $info.owner = '' }
  return $info
}

$result = [ordered]@{}
foreach ($code in $FILES.Keys) {
  $f = Get-ChildItem -LiteralPath $Forms -File | Where-Object { $_.Name -like ('*' + $FILES[$code] + '*') } | Select-Object -First 1
  if (-not $f) { Write-Warning "missing form for $code"; continue }
  $p = Parse-Form $f.FullName
  $result[$code] = $p
  "{0,-4} subs={1,3} levels={2,4} steps={3,4} mr={4,4}" -f $code, $p.subs.Count, ($p.subs | ForEach-Object { $_.levels.Count } | Measure-Object -Sum).Sum, ($p.subs | ForEach-Object { $_.levels } | ForEach-Object { $_.steps.Count } | Measure-Object -Sum).Sum, ($p.subs | ForEach-Object { $_.levels } | ForEach-Object { $_.mr.Count } | Measure-Object -Sum).Sum
}
$seedText = [IO.File]::ReadAllText($Seed, [Text.Encoding]::UTF8)
$seedJson = [regex]::Match($seedText, '(?s)var SEED_ENABLERS = (\[.*?\]);').Groups[1].Value
# Personal names stay out of the mockup: keep unit names, replace people with a role label
if (-not $KeepNames) { $seedJson = [regex]::Replace($seedJson, '"owner":"[^"]*(นาย|นาง)[^"]*"', '"owner":"ผู้รับผิดชอบตัวชี้วัด"') }
$json = $result | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($Out, "window.CBE_SEED=$seedJson;`nwindow.CBE_FORMS=$json;", (New-Object Text.UTF8Encoding $false))
"wrote {0:N0} KB" -f ((Get-Item $Out).Length / 1KB)
