$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $root 'assets\generated'
$plugin = Join-Path $root 'com.driveline.codex-command-center.sdPlugin'
$actions = @(
    'brainpower',
    'model',
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

Write-Host "Generated $($actions.Count) action icon sets plus category and plugin artwork."
