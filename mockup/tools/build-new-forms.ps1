# Build one new-format report form per indicator from the old forms, using the V.Update SM workbook as the template.
# The template's styles, formulas, validations and conditional formats are reused; rows are generated per sub-issue/level.
# Usage:
#   powershell -File mockup\tools\forms-to-json.ps1 -Forms "Old Form" -Seed <repo>\src\Seed.gs -Out forms.js -KeepNames
#   powershell -File mockup\tools\build-new-forms.ps1 -Template "<V.Update>.xlsx" -Data forms.js -OutDir "New Form"
# By default the forms are blank for a new round: criteria, targets, monthly plan (timing), required documents and last year's GAP
# are kept; results, narratives, document ticks/names and กปม. remarks are cleared. -WithResults keeps the old results.
param($Template, $Data, $OutDir, [string[]]$Only, [switch]$WithResults)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$S2 = "'2.ผลตามเกณฑ์และ GAP'"
$OTHER = 'เอกสารประกอบอื่น (ถ้ามี)'
$PARTS = 'CG', 'SP', 'RM', 'SM', 'CM', 'DT', 'HCM', 'KM', 'IM', 'IA'
$NAMES = @{ CM = 'การมุ่งเน้นลูกค้า' }

function X([string]$s) { if ($null -eq $s) { return '' }; ($s -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', '') -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;' -replace '"', '&quot;' }
function Col([int]$n) { $s = ''; while ($n -gt 0) { $m = ($n - 1) % 26; $s = [char](65 + $m) + $s; $n = [math]::Floor(($n - 1) / 26) }; $s }
$COLS = 1..30 | ForEach-Object { Col $_ }   # A..AD
function CStr($ref, $s, $st) { if (-not $s) { return "<c r=`"$ref`" s=`"$st`"/>" }; "<c r=`"$ref`" s=`"$st`" t=`"inlineStr`"><is><t xml:space=`"preserve`">$(X $s)</t></is></c>" }
function CNum($ref, $v, $st) { if ($null -eq $v -or "$v" -eq '') { return "<c r=`"$ref`" s=`"$st`"/>" }; "<c r=`"$ref`" s=`"$st`"><v>$([double]$v)</v></c>" }
function CF($ref, $f, $st, [switch]$Str) { "<c r=`"$ref`" s=`"$st`"$(if ($Str) { ' t="str"' })><f>$(X $f)</f></c>" }
function Row($r, $ht, $cells) { "<row r=`"$r`" spans=`"1:30`" ht=`"$ht`" customHeight=`"1`">$($cells -join '')</row>" }
function Arr($a) { if ($null -eq $a) { @() } elseif ($a -is [array]) { $a } else { @($a) } }

# ---------- data ----------
$txt = [IO.File]::ReadAllText((Resolve-Path $Data), [Text.Encoding]::UTF8)
$seedJson = [regex]::Match($txt, '(?s)window\.CBE_SEED=(.*?);\s*window\.CBE_FORMS=').Groups[1].Value
$formsJson = [regex]::Match($txt, '(?s)window\.CBE_FORMS=(.*);\s*$').Groups[1].Value
$SEED = @{}; ($seedJson | ConvertFrom-Json) | ForEach-Object { $SEED[$_.code] = $_ }
$FORMS = $formsJson | ConvertFrom-Json

function Get-Subs($key) {
  $f = $FORMS.($(if ($key -eq 'DT') { 'IT' } else { $key }))
  $extra = if ($key -eq 'DT') { $FORMS.DT } else { $null }
  $seedSubs = @{}; if ($SEED[$key]) { foreach ($tp in @($SEED[$key].topics)) { if ($null -eq $tp) { continue }; foreach ($sx in @($tp[3])) { if ($sx) { $seedSubs[$sx[0]] = $sx } } } }
  $subs = @(Arr $f.subs | Where-Object { (Arr $_.levels).Count })
  $assumed = -not ($subs | Where-Object { $_.weight -or $seedSubs[$_.code] })
  foreach ($s in $subs) {
    $byLv = [ordered]@{}
    foreach ($L in (Arr $s.levels)) {
      $k = "$([int]$L.level)"   # string key: an int would index the ordered dictionary by position
      if (-not $byLv.Contains($k)) { $byLv[$k] = [ordered]@{ level = [int]$k; criteria = $L.criteria; gap = $L.gap; steps = @(); narrative = ''; mr = @(); remark = '' } }
      $t = $byLv[$k]
      $t.steps += Arr $L.steps; $t.mr += Arr $L.mr
      foreach ($fld in 'narrative', 'remark') { if ($L.$fld) { $t[$fld] = (($t[$fld], $L.$fld) | Where-Object { $_ }) -join "`n" } }
      if (-not $t.criteria) { $t.criteria = $L.criteria }; if (-not $t.gap) { $t.gap = $L.gap }
    }
    if ($extra) {
      foreach ($es in (Arr $extra.subs | Where-Object { $_.code -eq $s.code })) { foreach ($EL in (Arr $es.levels)) {
        $t = $byLv["$([int]$EL.level)"]; if (-not $t) { continue }
        if (-not $t.narrative -and $EL.narrative) { $t.narrative = $EL.narrative }
        if ($t.mr.Count -lt 2 -and (Arr $EL.mr).Count) { $t.mr = Arr $EL.mr }
        if (-not $t.remark -and $EL.remark) { $t.remark = $EL.remark }
      } }
    }
    $ss = $seedSubs[$s.code]
    [pscustomobject]@{
      code = $s.code; name = $(if ($ss) { $ss[1] } else { $s.name }); target = $s.target
      weight = $(if ($s.weight) { $s.weight } elseif ($ss) { $ss[2] } elseif ($assumed) { [math]::Round(50 / $subs.Count, 2) } else { 0 })
      assumed = [bool]$assumed; levels = @($byLv.Values | Sort-Object { $_.level } | Select-Object -First 5)
    }
  }
}

# Old forms list several activities per level; the new form tracks one count per level.
# One activity -> its own target/unit/plan/result. Several -> count of activities finished per month.
function Level-Track($L) {
  $steps = @(Arr $L.steps)
  $plan = @($null) * 12; $res = @($null) * 12
  if (-not $steps.Count) { return @{ target = $null; unit = ''; plan = $plan; res = $res; note = '' } }
  $tg = { param($st) if ($st.target) { [double]$st.target } else { [double](($st.plan | Measure-Object -Sum).Sum) } }
  $note = 'นับจากขั้นตอนการดำเนินงานในแบบฟอร์มเดิม:' + "`n" + (($steps | ForEach-Object -Begin { $i = 0 } -Process { $i++; $nm = "$($_.name)"; $(if ($nm -match '^\d') { $nm } else { "$i. $nm" }) + " (เป้า $(& $tg $_) $($_.unit))" }) -join "`n")
  if ($steps.Count -eq 1) {
    $st = $steps[0]
    for ($m = 0; $m -lt 12; $m++) { if ([double]$st.plan[$m]) { $plan[$m] = [double]$st.plan[$m] }; if ([double]$st.result[$m]) { $res[$m] = [double]$st.result[$m] } }
    return @{ target = (& $tg $st); unit = $st.unit; plan = $plan; res = $res; note = $note }
  }
  foreach ($st in $steps) {
    $t = & $tg $st; if ($t -le 0) { continue }
    foreach ($pair in @(@($st.plan, 'plan'), @($st.result, 'res'))) {
      $c = 0.0
      for ($m = 0; $m -lt 12; $m++) { $c += [double]$pair[0][$m]; if ($c -ge $t) { if ($pair[1] -eq 'plan') { $plan[$m] = [double]$plan[$m] + 1 } else { $res[$m] = [double]$res[$m] + 1 }; break } }
    }
  }
  @{ target = $steps.Count; unit = 'ขั้นตอน'; plan = $plan; res = $res; note = $note }
}

# ---------- sheet 2 ----------
function Build-Sheet2($subs, [ref]$merges, [ref]$comments, [ref]$blocks) {
  $rows = New-Object System.Collections.Generic.List[string]
  $r = 6
  foreach ($s in $subs) {
    $h = $r; $lvRows = @(); $r++
    $levelOut = New-Object System.Collections.Generic.List[string]
    foreach ($L in $s.levels) {
      $reqs = @(Arr $L.mr | Where-Object { $_.req -notmatch '^เอกสารประกอบอื่น' })
      $oth = @(Arr $L.mr | Where-Object { $_.req -match '^เอกสารประกอบอื่น' })
      $n = [math]::Max(2, $reqs.Count + 1); $f = $r; $e = $r + $n - 1; $lvRows += $f
      $tr = Level-Track $L
      $len = [math]::Max(("$($L.criteria)").Length, ("$($L.narrative)").Length / 1.3)
      $ht = [math]::Round([math]::Max(30, [math]::Min(200, ([math]::Ceiling($len / 70) * 16 + 10) / $n)), 1)
      $pm = "(COLUMN(G${f}:R${f})-COLUMN(G${f})+1<=MATCH(`$C`$3,ตัวเลือก!`$E`$1:`$E`$12,0))*G${f}:R${f}"
      $rm = "(COLUMN(G$($f+1):R$($f+1))-COLUMN(G$($f+1))+1<=MATCH(`$C`$3,ตัวเลือก!`$E`$1:`$E`$12,0))*G$($f+1):R$($f+1)"
      for ($k = 0; $k -lt $n; $k++) {
        $rr = $r + $k; $c = @()
        if ($k -eq 0) {
          $c += CStr "A$rr" $s.code 43; $c += CStr "B$rr" "ระดับ $($L.level)" 44; $c += CStr "C$rr" $L.criteria 45; $c += CNum "D$rr" $tr.target 46; $c += CStr "E$rr" $tr.unit 47
          $c += CStr "F$rr" 'แผน' 28; for ($m = 0; $m -lt 12; $m++) { $c += CNum "$($COLS[6+$m])$rr" $tr.plan[$m] 29 }; $c += CF "S$rr" "SUM(G${rr}:R${rr})" 30
          $c += CF "T$rr" "IF(OR(D$f=`"`",D$f=0),`"`",MIN(1,S$($f+1)/D$f))" 48
          $c += CF "U$rr" "IF(D$f=`"`",`"`",IF(S$($f+1)>=D$f,`"เสร็จแล้ว`",IF(SUMPRODUCT($pm)=0,IF(SUMPRODUCT($rm)>0,`"กำลังดำเนินการ`",`"ยังไม่ถึงกำหนด`"),IF(SUMPRODUCT($rm)>=SUMPRODUCT($pm),`"ตามแผน`",`"ล่าช้า`"))))" 49 -Str
          $c += CStr "V$rr" $(if ($WithResults) { $L.narrative } else { '' }) 58
        } elseif ($k -eq 1) {
          'A', 'B', 'C', 'D', 'E' | ForEach-Object { $c += "<c r=`"$_$rr`" s=`"43`"/>" }
          $c += CStr "F$rr" 'ผล' 34; for ($m = 0; $m -lt 12; $m++) { $c += CNum "$($COLS[6+$m])$rr" $(if ($WithResults) { $tr.res[$m] } else { $null }) 35 }; $c += CF "S$rr" "SUM(G${rr}:R${rr})" 30
          'T|48', 'U|49', 'V|58' | ForEach-Object { $p = $_ -split '\|'; $c += "<c r=`"$($p[0])$rr`" s=`"$($p[1])`"/>" }
        } else {
          'A', 'B', 'C', 'D', 'E' | ForEach-Object { $c += "<c r=`"$_$rr`" s=`"43`"/>" }
          6..19 | ForEach-Object { $c += "<c r=`"$($COLS[$_-1])$rr`" s=`"36`"/>" }
          'T|48', 'U|49', 'V|58' | ForEach-Object { $p = $_ -split '\|'; $c += "<c r=`"$($p[0])$rr`" s=`"$($p[1])`"/>" }
        }
        if ($k -eq $n - 1) {
          $has = $WithResults -and [bool]($oth | Where-Object { $_.has }); $ev = if ($WithResults) { (($oth | ForEach-Object { $_.evidence }) | Where-Object { $_ }) -join "`n" } else { '' }
          $c += CStr "W$rr" $OTHER 37; $c += CStr "X$rr" $(if ($has) { '✓' } else { '' }) 33; $c += CStr "Y$rr" $ev 31
        } else {
          $q = $reqs[$k]
          $c += CStr "W$rr" $(if ($q) { $q.req } else { '' }) 32; $c += CStr "X$rr" $(if ($WithResults -and $q -and $q.has) { '✓' } else { '' }) 33; $c += CStr "Y$rr" $(if ($WithResults -and $q) { $q.evidence } else { '' }) 31
        }
        if ($k -eq 0) {
          $c += CF "Z$rr" "IFERROR(COUNTIFS(W${f}:W${e},`"<>`",W${f}:W${e},`"<>$OTHER`",X${f}:X${e},`"✓`")/COUNTIFS(W${f}:W${e},`"<>`",W${f}:W${e},`"<>$OTHER`"),`"-`")" 48
          $c += CStr "AA$rr" $L.gap 58; $c += "<c r=`"AB$rr`" s=`"58`"/>"; $c += "<c r=`"AC$rr`" s=`"59`"/>"; $c += "<c r=`"AD$rr`" s=`"60`"/>"
        } else { 'Z|48', 'AA|58', 'AB|58', 'AC|59', 'AD|60' | ForEach-Object { $p = $_ -split '\|'; $c += "<c r=`"$($p[0])$rr`" s=`"$($p[1])`"/>" } }
        $levelOut.Add((Row $rr $ht $c))
      }
      if ($e -gt $f) { 'A', 'B', 'C', 'D', 'E', 'T', 'U', 'V', 'Z', 'AA', 'AB', 'AC', 'AD' | ForEach-Object { $merges.Value.Add("$_${f}:$_$e") } }
      if ($tr.note) { $comments.Value.Add(@{ ref = "D$f"; row = $f; col = 4; text = $tr.note }) }
      if ($WithResults -and $L.remark) { $comments.Value.Add(@{ ref = "V$f"; row = $f; col = 22; text = "ข้อสังเกต กปม. (แบบฟอร์มเดิม):`n$($L.remark)" }) }
      $r = $e + 1
    }
    $end = $r - 1; $nl = $s.levels.Count
    $term = { param($x) "IF(V$x=`"`",0,FLOOR(MIN(IF(ISNUMBER(T$x),T$x,0),IF(ISNUMBER(Z$x),Z$x,1))*4+0.000001,1)/4)" }
    $score = & $term $lvRows[-1]
    for ($i = $lvRows.Count - 2; $i -ge 0; $i--) { $t = & $term $lvRows[$i]; $score = "IF($t<1,$t,1+$score)" }
    $rg = "$($h+1):"; $U = "U$($h+1):U$end"
    $c = @()
    $c += CStr "A$h" $s.code 20; $c += CStr "B$h" "$($s.name)   (น้ำหนัก $($s.weight))" 50; $c += "<c r=`"C$h`" s=`"50`"/>"; $c += CNum "D$h" $nl 21; $c += CStr "E$h" 'คะแนน' 22; $c += "<c r=`"F$h`" s=`"22`"/>"
    7..19 | ForEach-Object { $c += "<c r=`"$($COLS[$_-1])$h`" s=`"23`"/>" }
    $c += CF "T$h" "SUM($(($lvRows | ForEach-Object { "T$_" }) -join ','))/D$h" 24
    $c += CF "U$h" "IF(COUNTIF($U,`"ล่าช้า`")>0,`"ล่าช้า`",IF(COUNTIF($U,`"เสร็จแล้ว`")=$nl,`"เสร็จแล้ว`",IF(COUNTIF($U,`"ตามแผน`")+COUNTIF($U,`"กำลังดำเนินการ`")+COUNTIF($U,`"เสร็จแล้ว`")>0,`"ตามแผน`",`"ยังไม่ถึงกำหนด`")))" 22 -Str
    $c += CF "V$h" $score 25; $c += CStr "W$h" 'หลักฐานครบ →' 26; $c += "<c r=`"X$h`" s=`"23`"/>"; $c += "<c r=`"Y$h`" s=`"23`"/>"
    $W = "W$($h+1):W$end"; $Xr = "X$($h+1):X$end"
    $c += CF "Z$h" "IFERROR(COUNTIFS($W,`"<>`",$W,`"<>$OTHER`",$Xr,`"✓`")/COUNTIFS($W,`"<>`",$W,`"<>$OTHER`"),`"-`")" 27
    $c += "<c r=`"AA$h`" s=`"23`"/>"; $c += "<c r=`"AB$h`" s=`"23`"/>"
    $c += CF "AC$h" "IFERROR(AVERAGEIFS(AC$($h+1):AC$end,F$($h+1):F$end,`"แผน`")/100,`"-`")" 27; $c += "<c r=`"AD$h`" s=`"23`"/>"
    $rows.Add((Row $h 30 $c)); $levelOut | ForEach-Object { $rows.Add($_) }
    $merges.Value.Add("B${h}:C$h")
    $blocks.Value.Add(@{ h = $h; f = $h + 1; e = $end; sub = $s })
  }
  @{ xml = ($rows -join ''); last = $r - 1 }
}

# ---------- build one workbook ----------
$tplDir = Join-Path $env:TEMP ('cbe-tpl-' + [guid]::NewGuid()); New-Item -ItemType Directory $tplDir | Out-Null
Copy-Item -LiteralPath (Resolve-Path $Template) "$tplDir\t.zip"; Expand-Archive "$tplDir\t.zip" "$tplDir\x"
$T = "$tplDir\x"
$sst = [xml](Get-Content "$T\xl\sharedStrings.xml" -Raw -Encoding UTF8)
$STR = @($sst.sst.si | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
$s1Tpl = [IO.File]::ReadAllText("$T\xl\worksheets\sheet1.xml", [Text.Encoding]::UTF8)
$s2Tpl = [IO.File]::ReadAllText("$T\xl\worksheets\sheet2.xml", [Text.Encoding]::UTF8)
$cmTpl = [IO.File]::ReadAllText("$T\xl\comments1.xml", [Text.Encoding]::UTF8)
$chTpl = [IO.File]::ReadAllText("$T\xl\charts\chart1.xml", [Text.Encoding]::UTF8)
New-Item -ItemType Directory -Force $OutDir | Out-Null

foreach ($key in $PARTS) {
  if ($Only -and $Only -notcontains $key) { continue }
  $subs = @(Get-Subs $key); if (-not $subs.Count) { Write-Warning "no data for $key"; continue }
  $sd = $SEED[$key]; $name = if ($NAMES[$key]) { $NAMES[$key] } else { $sd.name }
  $f0 = $FORMS.($(if ($key -eq 'DT') { 'IT' } else { $key }))
  $owner = if ($f0.owner) { $f0.owner } elseif ($sd -and $sd.owner) { $sd.owner } else { '............................' }
  $W = [math]::Round((($subs | ForEach-Object { [double]$_.weight }) | Measure-Object -Sum).Sum, 4)
  $merges = New-Object System.Collections.Generic.List[string]; $comments = New-Object System.Collections.Generic.List[object]; $blocks = New-Object System.Collections.Generic.List[object]
  $b2 = Build-Sheet2 $subs ([ref]$merges) ([ref]$comments) ([ref]$blocks); $L = $b2.last
  $title = "ตัวชี้วัด: $name ($key)"

  # sheet 2: header rows from the template with indicator-specific text, generated body, tail ranges resized
  $head = $s2Tpl.Substring(0, $s2Tpl.IndexOf('<row r="6"')) -replace '<dimension ref="[^"]+"/>', "<dimension ref=`"A1:AD$L`"/>"
  $a2 = $STR[46] -replace 'ตัวชี้วัด: [^ ]+ [^ ]+ \(SM\)|ตัวชี้วัด: การมุ่งเน้นผู้มีส่วนได้ส่วนเสีย \(SM\)', $title -replace 'ปีบัญชี: \.+', 'ปีบัญชี: 2569' -replace 'ผู้รับผิดชอบ: \.+', "ผู้รับผิดชอบ: $owner"
  $head = $head -replace '<c r="A2" s="53" t="s"><v>46</v></c>', (CStr 'A2' $a2 53)
  $head = $head -replace '<c r="C3" s="18" t="s"><v>48</v></c>', (CStr 'C3' $(if ($WithResults) { 'ก.ย.' } else { 'ต.ค.' }) 18)
  $tail = $s2Tpl.Substring($s2Tpl.IndexOf('</sheetData>'))
  $base = @('A1:AD1', 'A2:AD2', 'A3:B3', 'D3:AD3', 'A4:C4', 'D4:Z4', 'AA4:AC4')
  $allM = $base + $merges
  $mx = ($allM | ForEach-Object { '<mergeCell ref="' + $_ + '"/>' }) -join ''
  $tail = [regex]::Replace($tail, '<mergeCells[^>]*>.*?</mergeCells>', ('<mergeCells count="' + $allM.Count + '">' + $mx + '</mergeCells>'))
  $tail = $tail -replace 'U6:U177', "U6:U$L" -replace 'Z6:Z177', "Z6:Z$L"
  $gr = ($blocks | ForEach-Object { "G$($_.f):R$($_.e)" }) -join ' '; $ac = ($blocks | ForEach-Object { "AC$($_.f):AC$($_.e)" }) -join ' '; $xr = ($blocks | ForEach-Object { "X$($_.f):X$($_.e)" }) -join ' '
  $tail = $tail -replace 'sqref="G7:R26[^"]*"', "sqref=`"$gr`"" -replace 'sqref="AC7:AC26[^"]*"', "sqref=`"$ac`"" -replace '<xm:sqref>X7:X26[^<]*</xm:sqref>', "<xm:sqref>$xr</xm:sqref>"
  $sheet2 = $head + $b2.xml + $tail   # $head already holds <sheetData> and template rows 1-5

  # sheet 1: one summary row per sub-issue, totals and notes shifted below
  $n = $subs.Count; $tot = 13 + $n; $lastS = $tot - 1
  $h1 = $s1Tpl.Substring(0, $s1Tpl.IndexOf('<row r="13"'))
  $h1 = $h1 -replace 'I13:I24', "I13:I$lastS" -replace 'U6:U177', "U6:U$L" -replace 'F6:F177', "F6:F$L" -replace 'AC6:AC177', "AC6:AC$L" -replace 'F25', "F$tot" -replace 'D25', "D$tot" -replace 'H25', "H$tot"
  $h1 = $h1 -replace '(</f>)<v>[^<]*</v>', '$1' -replace '(</f>)<v/>', '$1'   # stale cached results only
  $h1 = $h1 -replace '<c r="A1" s="52" t="s"><v>0</v></c>', (CStr 'A1' "สรุปรายงานผู้บริหาร : $name ($key)" 52)
  $a1two = $STR[1] -replace 'ตัวชี้วัด: การมุ่งเน้นผู้มีส่วนได้ส่วนเสีย \(SM\)', $title -replace 'ปีบัญชี: \.+', 'ปีบัญชี: 2569' -replace 'ผู้รับผิดชอบ: \.+', "ผู้รับผิดชอบ: $owner"
  $h1 = $h1 -replace '<c r="A2" s="53" t="s"><v>1</v></c>', (CStr 'A2' $a1two 53)
  $rows1 = for ($i = 0; $i -lt $n; $i++) {
    $s = $subs[$i]; $b = $blocks[$i]; $r = 13 + $i
    Row $r 31.5 @(
      (CStr "A$r" $s.code 3), (CStr "B$r" $s.name 4), (CNum "C$r" $s.weight 5), (CNum "D$r" $s.target 6),
      (CF "E$r" "$S2!V$($b.h)" 7), (CF "F$r" "E$r*C$r/$W" 8), (CF "G$r" "IF(D$r=`"`",`"`",IF(E$r>=D$r,`"บรรลุ`",`"ไม่บรรลุ`"))" 9 -Str),
      (CF "H$r" "$S2!Z$($b.h)" 10), (CF "I$r" "$S2!T$($b.h)" 10),
      (CF "J$r" "COUNTIFS($S2!A6:A$L,A$r,$S2!U6:U$L,`"ล่าช้า`",$S2!F6:F$L,`"แผน`")" 9),
      (CStr "K$r" $(if ($s.assumed) { 'น้ำหนักชั่วคราว รอยืนยันตามคู่มือ SE-AM' } else { '' }) 11))
  }
  $gF = 'IF(COUNT(D13:D' + $lastS + ')=0,"",IF(F' + $tot + '>=D' + $tot + ',"บรรลุ","ไม่บรรลุ"))'
  $rt = '<row r="' + $tot + '" spans="1:11" ht="15.75"><c r="A' + $tot + '" s="12"/>' + (CStr "B$tot" "รวม $key (คะแนนเต็ม 5.00)" 13) + (CF "C$tot" "SUM(C13:C$lastS)" 14) +
    (CF "D$tot" "IF(COUNT(D13:D$lastS)=0,0,SUMPRODUCT(C13:C$lastS,D13:D$lastS)/C$tot)" 15) + '<c r="E' + $tot + '" s="12"/>' + (CF "F$tot" "SUM(F13:F$lastS)" 16) + (CF "G$tot" $gF 12 -Str) +
    (CF "H$tot" "AVERAGE(H13:H$lastS)" 17) + (CF "I$tot" "AVERAGE(I13:I$lastS)" 17) + (CF "J$tot" "SUM(J13:J$lastS)" 12) + '<c r="K' + $tot + '" s="12"/></row>'
  $nt = $tot + 2
  $notes = ''
  foreach ($d in 0..2) {
    $r = $nt + $d; $notes += '<row r="' + $r + '" spans="1:11"' + $(if ($d -eq 0) { ' ht="15" customHeight="1"' } else { '' }) + '>'
    foreach ($cl in $COLS[0..10]) { $notes += $(if ($cl -eq 'A' -and $d -eq 0) { '<c r="A' + $r + '" s="63" t="s"><v>44</v></c>' } else { '<c r="' + $cl + $r + '" s="63"/>' }) }
    $notes += '</row>'
  }
  $t1 = $s1Tpl.Substring($s1Tpl.IndexOf('</sheetData>'))
  $t1 = $t1 -replace 'A27:K29', "A${nt}:K$($nt+2)" -replace 'G13:G25', "G13:G$tot" -replace 'J13:J25', "J13:J$tot"
  $sheet1 = ($h1 -replace '<dimension ref="[^"]+"/>', "<dimension ref=`"A1:K$($nt+2)`"/>") + ($rows1 -join '') + $rt + $notes + $t1

  # chart: point at the resized range and drop SM's cached values
  $chart = $chTpl -replace '\$A\$13:\$A\$24', "`$A`$13:`$A`$$lastS" -replace '\$D\$13:\$D\$24', "`$D`$13:`$D`$$lastS" -replace '\$E\$13:\$E\$24', "`$E`$13:`$E`$$lastS"
  $chart = [regex]::Replace($chart, '(?s)<c:(str|num)Cache>.*?</c:\1Cache>', '')

  # comments: keep the template's column note on D5, add one per level
  $firstC = [regex]::Match($cmTpl, '(?s)<comment ref="D5".*?</comment>').Value
  $cmx = ($comments | ForEach-Object { '<comment ref="' + $_.ref + '" authorId="0" shapeId="0"><text><r><rPr><sz val="10"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">' + (X $_.text) + '</t></r></text></comment>' }) -join ''
  $cm = $cmTpl.Substring(0, $cmTpl.IndexOf('<commentList>')) + '<commentList>' + $firstC + $cmx + '</commentList></comments>'
  # comment order in comments1.xml and shape order in the VML must line up: D5 first, then the generated ones
  $allC = @(@{ row = 5; col = 4 }) + $comments
  $shape = '<v:shape id="_x0000_s{0}" type="#_x0000_t202" style=''position:absolute;margin-left:60pt;margin-top:2pt;width:300pt;height:150pt;z-index:{1};visibility:hidden'' fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style=''mso-direction-alt:auto''><div style=''text-align:left''></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>{2}, 15, {3}, 2, {4}, 15, {5}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>{3}</x:Row><x:Column>{6}</x:Column></x:ClientData></v:shape>'
  $shapes = ''; $i = 0
  foreach ($cc in $allC) { $i++; $r0 = $cc.row - 1; $c0 = $cc.col - 1; $shapes += ($shape -f (2048 + $i), $i, ($c0 + 1), $r0, ($c0 + 5), ($r0 + 9), $c0) }
  $vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="2"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' + $shapes + '</xml>'

  # assemble: copy template parts, replace generated ones, drop the stale calc chain, recalc on open
  $W0 = Join-Path $env:TEMP ('cbe-out-' + [guid]::NewGuid()); Copy-Item $T $W0 -Recurse
  $u8 = New-Object Text.UTF8Encoding $false
  [IO.File]::WriteAllText("$W0\xl\worksheets\sheet1.xml", $sheet1, $u8)
  [IO.File]::WriteAllText("$W0\xl\worksheets\sheet2.xml", ($sheet2 -replace '(</f>)<v>[^<]*</v>', '$1'), $u8)
  [IO.File]::WriteAllText("$W0\xl\charts\chart1.xml", $chart, $u8)
  [IO.File]::WriteAllText("$W0\xl\comments1.xml", $cm, $u8)
  [IO.File]::WriteAllText("$W0\xl\drawings\vmlDrawing1.vml", $vml, $u8)
  Remove-Item "$W0\xl\calcChain.xml"
  $ct = [IO.File]::ReadAllText("$W0\[Content_Types].xml") -replace '<Override PartName="/xl/calcChain.xml"[^>]*/>', ''; [IO.File]::WriteAllText("$W0\[Content_Types].xml", $ct, $u8)
  $wr = [IO.File]::ReadAllText("$W0\xl\_rels\workbook.xml.rels") -replace '<Relationship Id="rId7"[^>]*calcChain[^>]*/>', ''; [IO.File]::WriteAllText("$W0\xl\_rels\workbook.xml.rels", $wr, $u8)
  $wb = [IO.File]::ReadAllText("$W0\xl\workbook.xml", [Text.Encoding]::UTF8) -replace '<calcPr ', '<calcPr fullCalcOnLoad="1" ' -replace '<x15ac:absPath[^>]*/>', ''; [IO.File]::WriteAllText("$W0\xl\workbook.xml", $wb, $u8)
  $out = Join-Path (Resolve-Path $OutDir) "แบบฟอร์มรายงานผล_$($key)_รวมเกณฑ์และGAP_2569.xlsx"
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out }
  $zip = [IO.Compression.ZipFile]::Open($out, 'Create')
  Get-ChildItem $W0 -Recurse -File | ForEach-Object { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $_.FullName.Substring($W0.Length + 1).Replace('\', '/')) }
  $zip.Dispose(); Remove-Item $W0 -Recurse -Force
  "{0,-4} subs={1,3} rows={2,4} notes={3,4} weight={4}" -f $key, $n, $L, $comments.Count, $W
}
Remove-Item $tplDir -Recurse -Force
