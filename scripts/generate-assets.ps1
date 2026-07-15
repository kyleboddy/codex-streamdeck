$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $root 'assets\generated'
$plugin = Join-Path $root 'com.driveline.codex-command-center.sdPlugin'
$actions = @(
    'brainpower',
    'model',
    'sentinel',
    'new-task',
    'review',
    'approve',
    'decline',
    'stop',
    'fork',
    'skills',
    'settings',
    'blank1',
    'blank2'
)

Add-Type -AssemblyName System.Drawing

function Export-ResizedPng {
    param(
        [Parameter(Mandatory)] [string] $Source,
        [Parameter(Mandatory)] [string] $Destination,
        [Parameter(Mandatory)] [int] $Size
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Generated source asset is missing: $Source"
    }

    $destinationDirectory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null

    $sourceImage = [System.Drawing.Image]::FromFile($Source)
    try {
        $bitmap = [System.Drawing.Bitmap]::new(
            $Size,
            $Size,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage(
                    $sourceImage,
                    [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
                    0,
                    0,
                    $sourceImage.Width,
                    $sourceImage.Height,
                    [System.Drawing.GraphicsUnit]::Pixel
                )
            }
            finally {
                $graphics.Dispose()
            }

            $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally {
            $bitmap.Dispose()
        }
    }
    finally {
        $sourceImage.Dispose()
    }
}

function Export-CroppedPng {
    param(
        [Parameter(Mandatory)] [System.Drawing.Image] $SourceImage,
        [Parameter(Mandatory)] [System.Drawing.Rectangle] $SourceRectangle,
        [Parameter(Mandatory)] [string] $Destination,
        [Parameter(Mandatory)] [int] $Size
    )

    $destinationDirectory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null

    $bitmap = [System.Drawing.Bitmap]::new(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            $graphics.DrawImage(
                $SourceImage,
                [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
                $SourceRectangle.X,
                $SourceRectangle.Y,
                $SourceRectangle.Width,
                $SourceRectangle.Height,
                [System.Drawing.GraphicsUnit]::Pixel
            )
        }
        finally {
            $graphics.Dispose()
        }
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }
}

$sentinelSheetPath = Join-Path $root 'assets\sentinel\sentinel-sprite-sheet.png'
if (-not (Test-Path -LiteralPath $sentinelSheetPath -PathType Leaf)) {
    throw "Sentinel sprite sheet is missing: $sentinelSheetPath"
}
$sentinelSheet = [System.Drawing.Image]::FromFile($sentinelSheetPath)
try {
    if ($sentinelSheet.Width -ne 1254 -or $sentinelSheet.Height -ne 1254) {
        throw "Sentinel sprite sheet must be 1254x1254; found $($sentinelSheet.Width)x$($sentinelSheet.Height)."
    }
    $columns = @(
        [System.Drawing.Rectangle]::new(4, 4, 307, 307),
        [System.Drawing.Rectangle]::new(317, 4, 307, 307),
        [System.Drawing.Rectangle]::new(630, 4, 307, 307),
        [System.Drawing.Rectangle]::new(943, 4, 306, 307)
    )
    $rowY = @(4, 317, 630, 943)
    $rowHeight = @(307, 307, 307, 306)
    $states = @('idle', 'working', 'waiting', 'disconnected')

    Export-CroppedPng `
        -SourceImage $sentinelSheet `
        -SourceRectangle $columns[0] `
        -Destination (Join-Path $sourceRoot 'sentinel.png') `
        -Size 307

    for ($row = 0; $row -lt $states.Count; $row++) {
        for ($column = 0; $column -lt $columns.Count; $column++) {
            $sourceRectangle = [System.Drawing.Rectangle]::new(
                $columns[$column].X,
                $rowY[$row],
                $columns[$column].Width,
                $rowHeight[$row]
            )
            Export-CroppedPng `
                -SourceImage $sentinelSheet `
                -SourceRectangle $sourceRectangle `
                -Destination (Join-Path $plugin "imgs\sentinel\$($states[$row])-$column.png") `
                -Size 144
        }
    }
}
finally {
    $sentinelSheet.Dispose()
}

foreach ($name in $actions) {
    $source = Join-Path $sourceRoot "$name.png"
    Export-ResizedPng -Source $source -Destination (Join-Path $plugin "imgs\actions\$name.png") -Size 72
    Export-ResizedPng -Source $source -Destination (Join-Path $plugin "imgs\actions\$name@2x.png") -Size 144
    Export-ResizedPng -Source $source -Destination (Join-Path $plugin "imgs\action-list\$name.png") -Size 20
    Export-ResizedPng -Source $source -Destination (Join-Path $plugin "imgs\action-list\$name@2x.png") -Size 40
}

$categorySource = Join-Path $sourceRoot 'category.png'
Export-ResizedPng -Source $categorySource -Destination (Join-Path $plugin 'imgs\category.png') -Size 28
Export-ResizedPng -Source $categorySource -Destination (Join-Path $plugin 'imgs\category@2x.png') -Size 56
Export-ResizedPng -Source $categorySource -Destination (Join-Path $plugin 'imgs\plugin.png') -Size 256
Export-ResizedPng -Source $categorySource -Destination (Join-Path $plugin 'imgs\plugin@2x.png') -Size 512

Write-Host "Generated $($actions.Count) action icon sets, 16 sentinel frames, plus category and plugin artwork."
