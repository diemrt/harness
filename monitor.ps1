# Notch di stato per harness.
#
# Un widget senza bordi agganciato in alto al centro dello schermo, che ogni pochi secondi
# rilancia `status-cli.mjs --oneline --color` e ne disegna la riga.
#
# Il punto delicato e' il colore: `--color` emette sequenze ANSI (`ESC[90m...ESC[0m`), e nessun
# controllo WinForms le interpreta — una Label le disegnerebbe alla lettera, che e' il motivo per
# cui i colori non si vedevano e comparivano caratteri spuri. Qui le sequenze vengono parsate in
# segmenti (testo, colore) e disegnati a mano nel Paint del form. La mappa dei codici resta quella
# di status-cli.mjs: nessuna seconda mappa da tenere in sincrono.
#
# Trascinamento col mouse, doppio clic per chiudere.

param(
    # La radice del progetto da guardare, cioe' la directory che contiene issues.json.
    [string]$ProjectDir = "C:\Users\diego_martignoni\Documents\Workspace\Projects\personal\herness",
    # La radice del plugin harness, cioe' la directory che contiene scripts/.
    [string]$PluginDir = "C:\Users\diego_martignoni\Documents\Workspace\Projects\personal\herness"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- CONFIGURAZIONE ---
$StatusCli    = Join-Path $PluginDir "scripts\status-cli.mjs"
$IntervalMs   = 1000
$CornerRadius = 14      # raggio dei due angoli inferiori
$PadX         = 18
$PadY         = 8
$FontSize     = 10

# node scrive UTF-8; senza questa riga PowerShell decodifica lo stdout nativo con la codepage
# della console e i caratteri non ASCII arrivano rotti.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- PALETTE ANSI ---
# I codici che status-cli.mjs emette davvero sono 31/32/33/36/90; gli altri ci sono perche' costano
# una riga e evitano che un colore aggiunto domani esca del colore di default senza dirlo.
$script:FgDefault = [System.Drawing.Color]::FromArgb(228, 228, 233)
$script:FgMuted   = [System.Drawing.Color]::FromArgb(120, 120, 128)
$script:Background = [System.Drawing.Color]::FromArgb(10, 10, 12)

$script:AnsiPalette = @{
    '30' = [System.Drawing.Color]::FromArgb(90, 90, 96)
    '31' = [System.Drawing.Color]::FromArgb(240, 100, 92)
    '32' = [System.Drawing.Color]::FromArgb(88, 214, 126)
    '33' = [System.Drawing.Color]::FromArgb(238, 200, 88)
    '34' = [System.Drawing.Color]::FromArgb(104, 152, 248)
    '35' = [System.Drawing.Color]::FromArgb(202, 128, 224)
    '36' = [System.Drawing.Color]::FromArgb(86, 208, 226)
    '37' = [System.Drawing.Color]::FromArgb(212, 212, 218)
    '90' = [System.Drawing.Color]::FromArgb(138, 138, 146)
    '91' = [System.Drawing.Color]::FromArgb(255, 128, 120)
    '92' = [System.Drawing.Color]::FromArgb(120, 235, 152)
    '93' = [System.Drawing.Color]::FromArgb(250, 220, 120)
    '94' = [System.Drawing.Color]::FromArgb(136, 178, 255)
    '95' = [System.Drawing.Color]::FromArgb(220, 156, 240)
    '96' = [System.Drawing.Color]::FromArgb(122, 226, 240)
    '97' = [System.Drawing.Color]::FromArgb(245, 245, 250)
}

function Resolve-AnsiColor {
    param([string]$Params, [System.Drawing.Color]$Current)

    # `ESC[m` vale `ESC[0m`: entrambi riportano al colore di default.
    if ([string]::IsNullOrEmpty($Params)) { return $script:FgDefault }

    $color = $Current
    foreach ($code in $Params.Split(';')) {
        if ($code -eq '' -or $code -eq '0') {
            $color = $script:FgDefault
        }
        elseif ($script:AnsiPalette.ContainsKey($code)) {
            $color = $script:AnsiPalette[$code]
        }
        # Ogni altro codice (bold, sfondo, 256 colori) non cambia il colore di primo piano: si
        # ignora invece di indovinare. Il testo resta leggibile, che e' l'unica cosa che conta qui.
    }
    return $color
}

function Convert-AnsiToSegments {
    param([string]$Text)

    $segments = New-Object System.Collections.Generic.List[object]
    $current  = $script:FgDefault
    $pos      = 0
    $matches  = [regex]::Matches($Text, '\x1b\[([0-9;]*)m')

    foreach ($m in $matches) {
        if ($m.Index -gt $pos) {
            $segments.Add([pscustomobject]@{
                Text  = $Text.Substring($pos, $m.Index - $pos)
                Color = $current
            })
        }
        $current = Resolve-AnsiColor -Params $m.Groups[1].Value -Current $current
        $pos = $m.Index + $m.Length
    }
    if ($pos -lt $Text.Length) {
        $segments.Add([pscustomobject]@{ Text = $Text.Substring($pos); Color = $current })
    }
    return $segments
}

# --- FONT ---
# Monospaziato per una ragione precisa: la coda della riga porta un orologio, e con un font
# proporzionale il widget si allarga e si stringe a ogni secondo che scatta. Il primo font
# disponibile vince; se nessuno c'e', si ripiega sul monospaziato generico di sistema.
function New-MonospaceFont {
    param([single]$Size)
    foreach ($name in @('Cascadia Mono', 'Consolas', 'Lucida Console')) {
        $candidate = New-Object System.Drawing.Font($name, $Size, [System.Drawing.FontStyle]::Regular)
        if ($candidate.Name -eq $name) { return $candidate }
        $candidate.Dispose()
    }
    return New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericMonospace, $Size)
}

$script:Font = New-MonospaceFont -Size $FontSize

# Larghezza di una cella, misurata su dieci caratteri per ammortizzare l'arrotondamento. Con un
# font monospaziato ogni segmento si posiziona contando i caratteri che lo precedono, invece di
# sommare larghezze misurate: nessuna deriva cumulativa fra un segmento e il successivo.
$script:TextFlags = [System.Windows.Forms.TextFormatFlags]::NoPadding `
    -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix `
    -bor [System.Windows.Forms.TextFormatFlags]::SingleLine

$probe = [System.Windows.Forms.TextRenderer]::MeasureText(
    '0000000000', $script:Font, [System.Drawing.Size]::Empty, $script:TextFlags)
$script:CellWidth = [Math]::Max(1, [Math]::Round($probe.Width / 10.0))
$script:LineHeight = $probe.Height

# --- FINESTRA ---
$form = New-Object System.Windows.Forms.Form
$form.Text            = "harness"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.TopMost         = $true
$form.ShowInTaskbar   = $false
$form.BackColor       = $script:Background
$form.Opacity         = 0.95
$form.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
$form.Height          = $script:LineHeight + ($PadY * 2)
$form.Width           = 320

# DoubleBuffered e' protected: senza reflection non si arriva, e senza di lei il ridisegno a ogni
# tick sfarfalla.
$form.GetType().GetProperty(
    'DoubleBuffered',
    [System.Reflection.BindingFlags]'Instance,NonPublic'
).SetValue($form, $true, $null)

$script:Segments = @()

# Il notch: angoli superiori squadrati, perche' la forma pende dal bordo dello schermo, e i due
# inferiori arrotondati. La Region non e' antialiasata — su un raggio di 14px si intravede un filo
# di scalettatura, ed e' il prezzo per non scrivere una finestra layered a canale alpha.
function Set-NotchShape {
    param([System.Windows.Forms.Form]$Target, [int]$Radius)

    $w = $Target.Width
    $h = $Target.Height
    $d = $Radius * 2
    if ($d -gt $w) { $d = $w }
    if ($d -gt $h) { $d = $h }

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddLine(0, 0, $w, 0)
    $path.AddArc(($w - $d), ($h - $d), $d, $d, 0, 90)
    $path.AddArc(0, ($h - $d), $d, $d, 90, 90)
    $path.CloseFigure()

    $old = $Target.Region
    $Target.Region = New-Object System.Drawing.Region($path)
    if ($old) { $old.Dispose() }
    $path.Dispose()
}

# La riga cambia lunghezza quando cambiano i conteggi: il widget si rimisura e torna al centro,
# cosi' resta centrato invece di scivolare verso destra.
$script:Pinned = $true   # finche' non lo trascini, resta agganciato al centro in alto

function Update-Geometry {
    $chars = 0
    foreach ($seg in $script:Segments) { $chars += $seg.Text.Length }
    $width = ($chars * $script:CellWidth) + ($PadX * 2)
    if ($width -lt 120) { $width = 120 }

    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($width -gt ($screen.Width - 40)) { $width = $screen.Width - 40 }

    if ($form.Width -ne $width) {
        if ($script:Pinned) {
            $form.Bounds = New-Object System.Drawing.Rectangle(
                [int](($screen.Width - $width) / 2), 0, $width, $form.Height)
        } else {
            $form.Width = $width
        }
        Set-NotchShape -Target $form -Radius $CornerRadius
    }
    elseif ($script:Pinned) {
        $form.Location = New-Object System.Drawing.Point(
            [int](($screen.Width - $width) / 2), 0)
    }
}

$form.Add_Paint({
    param($sender, $e)
    # Niente TextRenderingHint qui: TextRenderer disegna via GDI e quel suggerimento, che vale per
    # GDI+, verrebbe ignorato. Lo smoothing lo decide l'impostazione di sistema. GDI resta la scelta
    # giusta lo stesso, perche' misura e disegna con lo stesso motore — e qui la posizione di ogni
    # segmento viene proprio da una misura.
    # Il testo si centra nella finestra invece di partire dal margine: quasi sempre e' la stessa
    # cosa, perche' la larghezza viene calcolata sul testo — ma quando la larghezza tocca il minimo
    # (il trattino del tracker assente) o il tetto dello schermo, senza questo il testo pende.
    $chars = 0
    foreach ($seg in $script:Segments) { $chars += $seg.Text.Length }
    $x = [int](($sender.ClientSize.Width - ($chars * $script:CellWidth)) / 2)
    if ($x -lt 0) { $x = 0 }

    foreach ($seg in $script:Segments) {
        [System.Windows.Forms.TextRenderer]::DrawText(
            $e.Graphics,
            $seg.Text,
            $script:Font,
            (New-Object System.Drawing.Point($x, $PadY)),
            $seg.Color,
            $script:TextFlags)
        $x += $seg.Text.Length * $script:CellWidth
    }
})

# --- TRASCINAMENTO E CHIUSURA ---
$script:mouseDown = $false
$script:mousePos = New-Object System.Drawing.Point
$form.Add_MouseDown({
    param($sender, $e)
    $script:mouseDown = $true
    $script:mousePos = $e.Location
})
$form.Add_MouseMove({
    param($sender, $e)
    if ($script:mouseDown) {
        $script:Pinned = $false   # spostato a mano: da qui in poi resta dove lo hai messo
        $current = $form.Location
        $form.Location = New-Object System.Drawing.Point(
            ($current.X + $e.X - $script:mousePos.X),
            ($current.Y + $e.Y - $script:mousePos.Y))
    }
})
$form.Add_MouseUp({ $script:mouseDown = $false })
$form.Add_DoubleClick({ $form.Close() })

# --- AGGIORNAMENTO ---
# `--oneline` non fallisce mai e degrada a riga vuota (tracker assente, illeggibile, path sbagliato).
# Una finestra vuota sembrerebbe rotta, quindi in quel caso si disegna un trattino spento: dice
# «nessuna notizia» senza inventare un dato.
$EmptyGlyph = [string][char]0x2014

$updateText = {
    $line = ''
    try {
        $raw = & node $StatusCli --oneline --color --project-dir $ProjectDir 2>$null
        if ($null -ne $raw) { $line = ($raw -join '') }
    } catch {
        $line = ''
    }

    $bare = [regex]::Replace($line, '\x1b\[[0-9;]*m', '')
    if ([string]::IsNullOrWhiteSpace($bare)) {
        $script:Segments = @([pscustomobject]@{ Text = $EmptyGlyph; Color = $script:FgMuted })
    } else {
        $script:Segments = Convert-AnsiToSegments -Text $line
    }

    Update-Geometry
    $form.Invalidate()
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $IntervalMs
$timer.Add_Tick($updateText)

$form.Add_Load({
    Set-NotchShape -Target $form -Radius $CornerRadius
    & $updateText
    $timer.Start()
})

[System.Windows.Forms.Application]::Run($form)

$timer.Dispose()
$script:Font.Dispose()
