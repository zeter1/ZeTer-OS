param([switch]$Check)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$icons = Join-Path $root 'app/assets/icons'
$source = Join-Path $icons 'zeter-mark.svg'
[xml]$art = [IO.File]::ReadAllText($source)
$tileColor = $art.svg.GetAttribute('data-icon-background')
if ($tileColor -notmatch '^#[0-9a-fA-F]{6}$') { throw 'Master SVG must declare data-icon-background as #RRGGBB.' }
$namespace = [Xml.XmlNamespaceManager]::new($art.NameTable)
$namespace.AddNamespace('svg', 'http://www.w3.org/2000/svg')
$gradients = @{}
foreach ($node in $art.SelectNodes('//svg:linearGradient', $namespace)) { $gradients[$node.id] = $node }
$culture = [Globalization.CultureInfo]::InvariantCulture
function Number([string]$value) { return [float]::Parse($value, $culture) }
function Color([string]$value) { return [Drawing.ColorTranslator]::FromHtml($value) }
function RoundedPath([float]$radius) {
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc((256-$diameter), 0, $diameter, $diameter, 270, 90)
    $path.AddArc((256-$diameter), (256-$diameter), $diameter, $diameter, 0, 90)
    $path.AddArc(0, (256-$diameter), $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}
function RenderIcon([int]$size, [bool]$maskable = $false) {
    # Supersampling preserves the narrow negative spaces at favicon sizes.
    $large = [Drawing.Bitmap]::new(($size*4), ($size*4))
    $graphics = [Drawing.Graphics]::FromImage($large)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.ScaleTransform(($size*4/256), ($size*4/256))
    $background = [Drawing.SolidBrush]::new((Color $tileColor))
    # FillRectangle is antialiased at the bitmap border; Clear covers every pixel.
    if ($maskable) { $graphics.Clear((Color $tileColor)) }
    else { $outline = RoundedPath 52; $graphics.FillPath($background, $outline); $outline.Dispose() }
    $background.Dispose()
    $scale = if ($maskable) { 0.72 } else { 0.88 }
    $inset = (256 - 256*$scale)/2
    $graphics.TranslateTransform($inset, $inset)
    $graphics.ScaleTransform($scale, $scale)
    foreach ($polygon in $art.SelectNodes('//svg:polygon', $namespace)) {
        $points = [Drawing.PointF[]]@($polygon.points.Split(' ', [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object {
            $pair = $_.Split(','); [Drawing.PointF]::new((Number $pair[0]), (Number $pair[1]))
        })
        $id = $polygon.fill -replace '^url\(#|\)$', ''
        $gradient = $gradients[$id]
        if (-not $gradient) { throw "Unknown gradient: $id" }
        $stops = @($gradient.SelectNodes('svg:stop', $namespace))
        $blend = [Drawing.Drawing2D.ColorBlend]::new($stops.Count)
        $blend.Colors = [Drawing.Color[]]@($stops | ForEach-Object { Color ($_.GetAttribute('stop-color')) })
        $blend.Positions = [float[]]@($stops | ForEach-Object { if ($_.HasAttribute('offset')) { Number $_.offset } else { 0 } })
        $brush = [Drawing.Drawing2D.LinearGradientBrush]::new(
            [Drawing.PointF]::new((Number $gradient.x1), (Number $gradient.y1)),
            [Drawing.PointF]::new((Number $gradient.x2), (Number $gradient.y2)),
            $blend.Colors[0], $blend.Colors[-1])
        $brush.InterpolationColors = $blend
        $graphics.FillPolygon($brush, $points)
        $brush.Dispose()
    }
    $graphics.Dispose()
    $small = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($small)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Clamp the sampling border: maskable icons must stay fully opaque at every edge.
    $attributes = [Drawing.Imaging.ImageAttributes]::new()
    $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $destination = [Drawing.Rectangle]::new(0, 0, $size, $size)
    $graphics.DrawImage($large, $destination, 0, 0, $large.Width, $large.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
    $attributes.Dispose()
    $stream = [IO.MemoryStream]::new()
    $small.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $stream.Dispose(); $graphics.Dispose(); $small.Dispose(); $large.Dispose()
    return ,$bytes
}
$outputs = [ordered]@{}
$tile = $art.Clone()
$tile.svg.RemoveAttribute('role')
$tile.svg.RemoveAttribute('aria-label')
$rect = $tile.CreateElement('rect', $tile.svg.NamespaceURI)
foreach ($pair in @(@('width','256'), @('height','256'), @('rx','52'), @('fill',$tileColor))) { $rect.SetAttribute($pair[0], $pair[1]) }
[void]$tile.svg.InsertAfter($rect, $tile.svg.FirstChild)
$group = $tile.CreateElement('g', $tile.svg.NamespaceURI)
$group.SetAttribute('transform', 'translate(15.36 15.36) scale(.88)')
foreach ($polygon in @($tile.SelectNodes('//svg:polygon', $namespace))) { [void]$group.AppendChild($polygon) }
[void]$tile.svg.AppendChild($group)
$outputs['zeter-logo.svg'] = [Text.UTF8Encoding]::new($false).GetBytes("<!-- Generated by tools/build_brand_assets.ps1 from zeter-mark.svg. -->`n" + $tile.OuterXml + "`n")
foreach ($size in @(32,180,192,512)) { $outputs["zeter-icon-$size.png"] = RenderIcon $size }
$outputs['zeter-icon-maskable-512.png'] = RenderIcon 512 $true
$sizes = @(16,24,32,48,64,128,256)
$frames = @($sizes | ForEach-Object { ,(RenderIcon $_) })
$stream = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16*$sizes.Count
for ($i=0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
$writer.Flush(); $outputs['zeter-icon.ico'] = $stream.ToArray()
$writer.Dispose(); $stream.Dispose()
$stale = @()
foreach ($entry in $outputs.GetEnumerator()) {
    $target = Join-Path $icons $entry.Key
    if ($Check) {
        if (-not [IO.File]::Exists($target) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String($entry.Value)) { $stale += $entry.Key }
    } else { [IO.File]::WriteAllBytes($target, $entry.Value) }
}
if ($stale.Count) { throw ('Stale brand assets: ' + ($stale -join ', ')) }
Write-Output ("Brand assets: {0} ({1} files)" -f $(if ($Check) { 'verified' } else { 'generated' }), $outputs.Count)
