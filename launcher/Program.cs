using System.Diagnostics;

namespace CodexDeck.Launcher;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var transport = Environment.GetEnvironmentVariable("CODEX_DECK_TRANSPORT_PATH");
        if (string.IsNullOrWhiteSpace(transport))
        {
            transport = Path.Combine(AppContext.BaseDirectory, "codex-deck-transport.exe");
        }

        transport = Path.GetFullPath(transport);
        if (!File.Exists(transport))
        {
            await Console.Error.WriteLineAsync($"Codex Deck transport is missing at {transport}");
            return 1;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = transport,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Environment.CurrentDirectory,
        };

        foreach (var argument in args)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var child = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        try
        {
            if (!child.Start())
            {
                await Console.Error.WriteLineAsync("Codex Deck transport did not start.");
                return 1;
            }
        }
        catch (Exception error)
        {
            await Console.Error.WriteLineAsync($"Codex Deck transport failed to start: {error.Message}");
            return 1;
        }

        var parentInput = Console.OpenStandardInput();
        var parentOutput = Console.OpenStandardOutput();
        var parentError = Console.OpenStandardError();
        var inputPump = PumpInputAsync(parentInput, child.StandardInput.BaseStream);
        var outputPump = child.StandardOutput.BaseStream.CopyToAsync(parentOutput);
        var errorPump = child.StandardError.BaseStream.CopyToAsync(parentError);

        await child.WaitForExitAsync();
        try
        {
            child.StandardInput.Close();
        }
        catch
        {
            // The transport may close stdin while the desktop is shutting down.
        }

        await Task.WhenAll(outputPump, errorPump);
        await parentOutput.FlushAsync();
        await parentError.FlushAsync();
        GC.KeepAlive(inputPump);
        return child.ExitCode;
    }

    private static async Task PumpInputAsync(Stream source, Stream destination)
    {
        try
        {
            await source.CopyToAsync(destination);
            await destination.FlushAsync();
            destination.Close();
        }
        catch (IOException)
        {
            // Normal when either Codex or the transport exits first.
        }
        catch (ObjectDisposedException)
        {
            // Normal during coordinated shutdown.
        }
    }
}
