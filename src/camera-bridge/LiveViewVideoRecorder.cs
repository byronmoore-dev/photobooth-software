using System.Collections.Concurrent;
using System.Diagnostics;

namespace CanonCameraBridge;

internal sealed record VideoRecordingResult(
    DateTime StartedAt,
    DateTime FirstFrameAt,
    DateTime EndedAt,
    int FrameCount,
    int DroppedFrames,
    long FileSize,
    double FramesPerSecond,
    int TimelineFramesPerSecond
);

/// <summary>
/// Samples immutable live-view JPEGs into a small bounded queue and feeds a
/// separate FFmpeg process. OfferFrame never waits, so recording cannot delay
/// Canon SDK work or a shutter command.
/// </summary>
internal sealed class LiveViewVideoRecorder : IDisposable
{
    private const int QueueCapacity = 8;
    private readonly object stateLock = new();
    private BlockingCollection<byte[]> queue;
    private CancellationTokenSource samplerCancellation;
    private Task samplerTask;
    private Task writerTask;
    private Task<string> stderrTask;
    private Process process;
    private byte[] latestFrame;
    private string outputPath;
    private DateTime startedAt;
    private int frameCount;
    private int droppedFrames;
    private int targetFramesPerSecond;
    private long firstFrameTicks;

    public bool IsRecording { get { lock (stateLock) return process != null; } }

    public DateTime Start(string ffmpegPath, string destination, int framesPerSecond = 20)
    {
        lock (stateLock)
        {
            if (process != null) throw new InvalidOperationException("A session video is already recording");
            var executable = Path.GetFullPath(ffmpegPath ?? "");
            outputPath = Path.GetFullPath(destination ?? "");
            if (!File.Exists(executable)) throw new FileNotFoundException("The bundled FFmpeg encoder is missing", executable);
            if (!string.Equals(Path.GetExtension(outputPath), ".mp4", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Session video output must be an MP4 file");
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            targetFramesPerSecond = Math.Clamp(framesPerSecond, 5, 30);
            queue = new BlockingCollection<byte[]>(QueueCapacity);
            samplerCancellation = new CancellationTokenSource();
            latestFrame = null;
            frameCount = 0;
            droppedFrames = 0;
            firstFrameTicks = 0;

            var startInfo = new ProcessStartInfo
            {
                FileName = executable,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            foreach (var argument in new[]
            {
                "-hide_banner", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", targetFramesPerSecond.ToString(),
                "-vcodec", "mjpeg", "-i", "pipe:0", "-an",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                "-f", "mp4", "-y", outputPath,
            }) startInfo.ArgumentList.Add(argument);

            process = Process.Start(startInfo) ?? throw new InvalidOperationException("FFmpeg could not be started");
            stderrTask = process.StandardError.ReadToEndAsync();
            startedAt = DateTime.UtcNow;
            writerTask = Task.Run(WriteFrames);
            samplerTask = Task.Run(() => SampleFrames(samplerCancellation.Token));
            return startedAt;
        }
    }

    public void OfferFrame(byte[] jpeg)
    {
        if (jpeg == null || jpeg.Length < 4 || !IsRecording) return;
        Volatile.Write(ref latestFrame, jpeg);
    }

    private async Task SampleFrames(CancellationToken cancellationToken)
    {
        var delay = TimeSpan.FromMilliseconds(1000d / targetFramesPerSecond);
        try
        {
            using var timer = new PeriodicTimer(delay);
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                var frame = Volatile.Read(ref latestFrame);
                if (frame == null) continue;
                if (!queue.TryAdd(frame)) Interlocked.Increment(ref droppedFrames);
                else Interlocked.CompareExchange(ref firstFrameTicks, DateTime.UtcNow.Ticks, 0);
            }
        }
        catch (OperationCanceledException) { }
    }

    private void WriteFrames()
    {
        try
        {
            foreach (var frame in queue.GetConsumingEnumerable())
            {
                process.StandardInput.BaseStream.Write(frame, 0, frame.Length);
                Interlocked.Increment(ref frameCount);
            }
        }
        catch (IOException) when (process?.HasExited == true) { }
    }

    public VideoRecordingResult Stop()
    {
        Process encoder;
        string failure = null;
        lock (stateLock)
        {
            encoder = process ?? throw new InvalidOperationException("No session video is recording");
            samplerCancellation.Cancel();
            try { samplerTask.Wait(TimeSpan.FromSeconds(2)); } catch (AggregateException) { }
            queue.CompleteAdding();
            try
            {
                if (!writerTask.Wait(TimeSpan.FromSeconds(15))) failure = "FFmpeg could not finish the session video";
            }
            catch (AggregateException ex) { failure = ex.GetBaseException().Message; }
            try { encoder.StandardInput.Close(); } catch { }
        }

        if (failure != null || !encoder.WaitForExit(20_000))
        {
            try { encoder.Kill(true); } catch { }
            try { encoder.WaitForExit(2_000); } catch { }
            failure ??= "FFmpeg could not finalize the session video";
        }
        stderrTask.Wait(TimeSpan.FromSeconds(2));
        var error = stderrTask.IsCompletedSuccessfully ? stderrTask.Result.Trim() : "";
        var endedAt = DateTime.UtcNow;
        var size = File.Exists(outputPath) ? new FileInfo(outputPath).Length : 0;
        var frames = Volatile.Read(ref frameCount);
        var seconds = Math.Max(0.001, (endedAt - startedAt).TotalSeconds);
        var firstFrameAt = new DateTime(Volatile.Read(ref firstFrameTicks), DateTimeKind.Utc);
        var result = new VideoRecordingResult(
            startedAt,
            firstFrameAt,
            endedAt,
            frames,
            Volatile.Read(ref droppedFrames),
            size,
            frames / seconds,
            targetFramesPerSecond
        );

        lock (stateLock)
        {
            var exitCode = encoder.HasExited ? encoder.ExitCode : -1;
            encoder.Dispose();
            samplerCancellation.Dispose();
            process = null;
            queue = null;
            samplerTask = null;
            writerTask = null;
            stderrTask = null;
            samplerCancellation = null;
            latestFrame = null;
            if (failure != null || exitCode != 0 || size == 0 || frames == 0)
                throw new InvalidOperationException(
                    failure ?? (string.IsNullOrWhiteSpace(error) ? "FFmpeg did not create a valid session video" : error)
                );
        }
        return result;
    }

    public void Dispose()
    {
        if (!IsRecording) return;
        try { Stop(); }
        catch
        {
            lock (stateLock)
            {
                try { process?.Kill(true); } catch { }
                process?.Dispose();
                samplerCancellation?.Dispose();
                process = null;
            }
        }
    }
}
