using System.Collections.Concurrent;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using Canon = EDSDKLib.EDSDK;

namespace CanonCameraBridge;

internal sealed class CommandEnvelope
{
    public string Id { get; set; } = "";
    public string Command { get; set; } = "";
    public JsonElement Args { get; set; }
}

internal sealed class CameraHost : IDisposable
{
    // The renderer starts this atomic operation 500 ms before countdown zero.
    // Sending the full press just before zero compensates for T6i shutter/pre-flash latency.
    private const int FocusHoldMilliseconds = 450;
    private readonly ConcurrentQueue<CommandEnvelope> commands = new();
    private readonly ConcurrentQueue<IntPtr> transferItems = new();
    private readonly object outputLock = new();
    private readonly Canon.EdsObjectEventHandler objectHandler;
    private readonly Canon.EdsStateEventHandler stateHandler;
    private IntPtr camera;
    private bool sdkLoaded;
    private bool connected;
    private bool liveView;
    private bool running = true;
    private string productName = "Canon camera";
    private string firmware = "";
    private string exposureMode = "Unknown";
    private string automaticSettings = "";
    private string pendingCaptureId;
    private string pendingCapturePath;
    private DateTime pendingCaptureStarted;
    private DateTime nextFrameAt = DateTime.MinValue;
    private int consecutiveFrameErrors;

    public CameraHost()
    {
        objectHandler = HandleObjectEvent;
        stateHandler = HandleStateEvent;
    }

    [STAThread]
    public static int MainLoop()
    {
        using var host = new CameraHost();
        _ = Task.Run(host.ReadCommands);
        host.Write(new { type = "ready", pid = Environment.ProcessId });
        while (host.running)
        {
            Application.DoEvents();
            host.ProcessCommands();
            host.ProcessTransfers();
            host.ProcessCaptureTimeout();
            host.ProcessLiveView();
            Thread.Sleep(8);
        }
        return 0;
    }

    private async Task ReadCommands()
    {
        string line;
        while ((line = await Console.In.ReadLineAsync()) != null)
        {
            try
            {
                var command = JsonSerializer.Deserialize<CommandEnvelope>(line, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (command != null) commands.Enqueue(command);
            }
            catch (Exception ex) { Write(new { type = "protocolError", error = ex.Message }); }
        }
        running = false;
    }

    private void ProcessCommands()
    {
        while (commands.TryDequeue(out var command))
        {
            try
            {
                switch (command.Command)
                {
                    case "connect": Connect(); Respond(command.Id, Status()); break;
                    case "disconnect": Disconnect(); Respond(command.Id, Status()); break;
                    case "startLiveView": StartLiveView(); Respond(command.Id, Status()); break;
                    case "stopLiveView": StopLiveView(); Respond(command.Id, Status()); break;
                    case "status": Respond(command.Id, Status()); break;
                    case "capture": BeginCapture(command); break;
                    case "shutdown": Respond(command.Id, new { stopped = true }); running = false; break;
                    default: throw new InvalidOperationException($"Unknown command: {command.Command}");
                }
            }
            catch (Exception ex) { RespondError(command.Id, ex.Message); }
        }
    }

    private void Connect()
    {
        if (connected) return;
        if (!sdkLoaded)
        {
            Check(Canon.EdsInitializeSDK(), "initialize EDSDK");
            sdkLoaded = true;
        }
        try
        {
            IntPtr list = IntPtr.Zero;
            try
            {
                Check(Canon.EdsGetCameraList(out list), "get camera list");
                Check(Canon.EdsGetChildCount(list, out var count), "count cameras");
                if (count < 1) throw new InvalidOperationException("No Canon camera detected. Connect the T6i by USB, turn it on, disable Wi-Fi, and close EOS Utility.");
                Check(Canon.EdsGetChildAtIndex(list, 0, out camera), "select camera");
            }
            finally { if (list != IntPtr.Zero) Canon.EdsRelease(list); }

            Check(Canon.EdsSetObjectEventHandler(camera, Canon.ObjectEvent_All, objectHandler, IntPtr.Zero), "register object events");
            Check(Canon.EdsSetCameraStateEventHandler(camera, Canon.StateEvent_All, stateHandler, IntPtr.Zero), "register state events");
            Check(Canon.EdsOpenSession(camera), "open camera session");
            Check(Canon.EdsSetPropertyData(camera, Canon.PropID_SaveTo, 0, sizeof(uint), (uint)Canon.EdsSaveTo.Host), "set host storage");
            var capacity = new Canon.EdsCapacity { NumberOfFreeClusters = 0x7fffffff, BytesPerSector = 0x1000, Reset = 1 };
            Check(Canon.EdsSetCapacity(camera, capacity), "set host capacity");
            var jpegSmallFine = (uint)Canon.ImageQuality.EdsImageQuality_S1JF;
            Check(Canon.EdsSetPropertyData(camera, Canon.PropID_ImageQuality, 0, sizeof(uint), jpegSmallFine), "set JPEG Small 1 Fine");
            ApplyAutomaticPhotoSettings();
            Canon.EdsGetPropertyData(camera, Canon.PropID_ProductName, 0, out productName);
            Canon.EdsGetPropertyData(camera, Canon.PropID_FirmwareVersion, 0, out firmware);
            connected = true;
            Write(new { type = "status", status = Status() });
        }
        catch { Disconnect(); throw; }
    }

    private void Disconnect()
    {
        if (camera != IntPtr.Zero)
        {
            try { Canon.EdsSendCommand(camera, Canon.CameraCommand_PressShutterButton, (int)Canon.EdsShutterButton.CameraCommand_ShutterButton_OFF); } catch { }
            try { if (liveView) StopLiveView(); } catch { }
            try { Canon.EdsCloseSession(camera); } catch { }
            Canon.EdsRelease(camera); camera = IntPtr.Zero;
        }
        if (sdkLoaded) { Canon.EdsTerminateSDK(); sdkLoaded = false; }
        connected = false; liveView = false;
    }

    private void StartLiveView()
    {
        RequireConnected();
        Canon.EdsGetPropertyData(camera, Canon.PropID_Evf_Mode, 0, out uint mode);
        if (mode == 0) Check(Canon.EdsSetPropertyData(camera, Canon.PropID_Evf_Mode, 0, sizeof(uint), 1u), "enable live view mode");
        TrySetUInt(Canon.PropID_Evf_AFMode, (uint)Canon.EdsEvfAFMode.Evf_AFMode_LiveMulti);
        Check(Canon.EdsGetPropertyData(camera, Canon.PropID_Evf_OutputDevice, 0, out uint device), "read live view output");
        Check(Canon.EdsSetPropertyData(camera, Canon.PropID_Evf_OutputDevice, 0, sizeof(uint), device | Canon.EvfOutputDevice_PC), "start PC live view");
        liveView = true; consecutiveFrameErrors = 0; nextFrameAt = DateTime.MinValue;
    }

    private void StopLiveView()
    {
        if (!connected || !liveView) return;
        if (Canon.EdsGetPropertyData(camera, Canon.PropID_Evf_OutputDevice, 0, out uint device) == Canon.EDS_ERR_OK)
            Check(Canon.EdsSetPropertyData(camera, Canon.PropID_Evf_OutputDevice, 0, sizeof(uint), device & ~Canon.EvfOutputDevice_PC), "stop PC live view");
        liveView = false;
    }

    private void ProcessLiveView()
    {
        if (!connected || !liveView || DateTime.UtcNow < nextFrameAt) return;
        nextFrameAt = DateTime.UtcNow.AddMilliseconds(75);
        IntPtr stream = IntPtr.Zero, image = IntPtr.Zero;
        try
        {
            var err = Canon.EdsCreateMemoryStream(2UL * 1024 * 1024, out stream);
            if (err == Canon.EDS_ERR_OK) err = Canon.EdsCreateEvfImageRef(stream, out image);
            if (err == Canon.EDS_ERR_OK) err = Canon.EdsDownloadEvfImage(camera, image);
            if (err == Canon.EDS_ERR_OBJECT_NOTREADY || err == Canon.EDS_ERR_DEVICE_BUSY) return;
            Check(err, "download live view frame");
            Check(Canon.EdsGetLength(stream, out var length), "read live view length");
            Check(Canon.EdsGetPointer(stream, out var pointer), "read live view pointer");
            if (length == 0 || length > 8 * 1024 * 1024) return;
            var bytes = new byte[(int)length]; Marshal.Copy(pointer, bytes, 0, bytes.Length);
            Write(new { type = "frame", jpeg = Convert.ToBase64String(bytes), at = DateTime.UtcNow });
            consecutiveFrameErrors = 0;
        }
        catch (Exception ex)
        {
            if (++consecutiveFrameErrors == 5) Write(new { type = "cameraError", error = ex.Message });
        }
        finally { if (image != IntPtr.Zero) Canon.EdsRelease(image); if (stream != IntPtr.Zero) Canon.EdsRelease(stream); }
    }

    private void BeginCapture(CommandEnvelope command)
    {
        RequireConnected();
        if (pendingCaptureId != null) throw new InvalidOperationException("A capture is already in progress");
        if (!command.Args.TryGetProperty("path", out var pathElement)) throw new InvalidOperationException("Capture destination is required");
        var destination = Path.GetFullPath(pathElement.GetString() ?? "");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        pendingCaptureId = command.Id; pendingCapturePath = destination; pendingCaptureStarted = DateTime.UtcNow;
        try
        {
            Check(Canon.EdsSendCommand(camera, Canon.CameraCommand_PressShutterButton, (int)Canon.EdsShutterButton.CameraCommand_ShutterButton_Halfway), "start autofocus");
            Thread.Sleep(FocusHoldMilliseconds);
            var err = Canon.EdsSendCommand(camera, Canon.CameraCommand_PressShutterButton, (int)Canon.EdsShutterButton.CameraCommand_ShutterButton_Completely);
            var releaseError = Canon.EdsSendCommand(camera, Canon.CameraCommand_PressShutterButton, (int)Canon.EdsShutterButton.CameraCommand_ShutterButton_OFF);
            if (err == Canon.EDS_ERR_OK) err = releaseError;
            Check(err, "trigger shutter");
        }
        catch
        {
            Canon.EdsSendCommand(camera, Canon.CameraCommand_PressShutterButton, (int)Canon.EdsShutterButton.CameraCommand_ShutterButton_OFF);
            ClearPendingCapture();
            throw;
        }
    }

    private void ApplyAutomaticPhotoSettings()
    {
        var applied = new List<string>();
        if (TrySetUInt(Canon.PropID_WhiteBalance, (uint)Canon.WhiteBalance_Auto)) applied.Add("AWB");
        if (TrySetUInt(Canon.PropID_ISOSpeed, 0)) applied.Add("Auto ISO");
        if (TrySetUInt(Canon.PropID_ExposureCompensation, 0)) applied.Add("zero exposure compensation");
        if (TrySetUInt(Canon.PropID_DriveMode, 0)) applied.Add("single-shot drive");
        if (TrySetUInt(Canon.PropID_PictureStyle, Canon.PictureStyle_Auto)) applied.Add("Auto Picture Style");
        if (TrySetUInt(Canon.PropID_ColorSpace, Canon.ColorSpace_sRGB)) applied.Add("sRGB");
        automaticSettings = string.Join(", ", applied);

        if (Canon.EdsGetPropertyData(camera, Canon.PropID_AEMode, 0, out uint mode) == Canon.EDS_ERR_OK)
        {
            exposureMode = mode switch
            {
                Canon.AEMode_Program => "Program (P)",
                Canon.AEMode_Green or Canon.AEMode_SceneIntelligentAuto => "Full Auto",
                Canon.AEMode_CreativeAuto => "Creative Auto",
                Canon.AEMode_Tv => "Shutter priority (Tv)",
                Canon.AEMode_Av => "Aperture priority (Av)",
                Canon.AEMode_Mamual => "Manual (M)",
                _ => $"camera mode 0x{mode:X2}"
            };
        }
    }

    private bool TrySetUInt(uint propertyId, uint value)
    {
        var descError = Canon.EdsGetPropertyDesc(camera, propertyId, out var description);
        if (descError == Canon.EDS_ERR_OK && description.NumElements > 0 &&
            !description.PropDesc.Take(description.NumElements).Contains(unchecked((int)value))) return false;
        return Canon.EdsSetPropertyData(camera, propertyId, 0, sizeof(uint), value) == Canon.EDS_ERR_OK;
    }

    private void ProcessTransfers()
    {
        while (transferItems.TryDequeue(out var item))
        {
            try
            {
                if (pendingCapturePath == null) { Canon.EdsDownloadCancel(item); continue; }
                Check(Canon.EdsGetDirectoryItemInfo(item, out var info), "read captured image information");
                IntPtr stream = IntPtr.Zero;
                try
                {
                    Check(Canon.EdsCreateFileStream(pendingCapturePath, Canon.EdsFileCreateDisposition.CreateAlways, Canon.EdsAccess.ReadWrite, out stream), "create capture file");
                    Check(Canon.EdsDownload(item, info.Size, stream), "download captured JPEG");
                    Check(Canon.EdsDownloadComplete(item), "complete captured JPEG download");
                }
                finally { if (stream != IntPtr.Zero) Canon.EdsRelease(stream); }
                var flash = ReadFlashResult(pendingCapturePath);
                if (!flash.Fired)
                {
                    throw new InvalidOperationException(
                        flash.Recorded
                            ? "The Canon flash did not fire. Raise the T6i built-in flash and wait for it to charge, then tap Retry. This photo was not added."
                            : "The Canon photo did not include flash confirmation. Check that the built-in flash is raised and enabled, then tap Retry. This photo was not added."
                    );
                }
                var id = pendingCaptureId; var path = pendingCapturePath; ClearPendingCapture();
                Respond(id, new { path, capturedAt = DateTime.UtcNow, flashFired = true });
            }
            catch (Exception ex) { var id = pendingCaptureId; ClearPendingCapture(); RespondError(id, ex.Message); }
            finally { Canon.EdsRelease(item); }
        }
    }

    private uint HandleObjectEvent(uint inEvent, IntPtr inRef, IntPtr inContext)
    {
        if (inEvent == Canon.ObjectEvent_DirItemRequestTransfer) transferItems.Enqueue(inRef);
        else if (inRef != IntPtr.Zero) Canon.EdsRelease(inRef);
        return Canon.EDS_ERR_OK;
    }

    private uint HandleStateEvent(uint inEvent, uint inParameter, IntPtr inContext)
    {
        if (inEvent == Canon.StateEvent_WillSoonShutDown) Canon.EdsSendCommand(camera, Canon.CameraCommand_ExtendShutDownTimer, 0);
        if (inEvent == Canon.StateEvent_Shutdown)
        {
            connected = false; liveView = false; camera = IntPtr.Zero;
            if (pendingCaptureId != null) { RespondError(pendingCaptureId, "Camera disconnected during capture"); ClearPendingCapture(); }
            Write(new { type = "status", status = Status() });
        }
        if (inEvent == Canon.StateEvent_CaptureError && pendingCaptureId != null)
        {
            RespondError(pendingCaptureId, $"Camera could not capture the photo (0x{inParameter:X8})"); ClearPendingCapture();
        }
        return Canon.EDS_ERR_OK;
    }

    private void ProcessCaptureTimeout()
    {
        if (pendingCaptureId != null && DateTime.UtcNow - pendingCaptureStarted > TimeSpan.FromSeconds(30))
        { RespondError(pendingCaptureId, "Timed out waiting for the camera to transfer the JPEG"); ClearPendingCapture(); }
    }

    private static (bool Recorded, bool Fired) ReadFlashResult(string path)
    {
        // EXIF tag 0x9209 is written by the T6i for every JPEG. Bit zero means
        // the flash actually emitted light; values such as 0x10 mean compulsory
        // flash was requested but could not fire (for example, the head is down).
        using var image = Image.FromFile(path);
        var property = image.PropertyItems.FirstOrDefault(item => item.Id == 0x9209);
        if (property?.Value == null || property.Value.Length == 0) return (false, false);

        var value = property.Value.Length >= sizeof(ushort)
            ? BitConverter.ToUInt16(property.Value, 0)
            : property.Value[0];
        return (true, (value & 0x01) == 0x01);
    }

    private object Status() => new
    {
        detected = connected,
        connected,
        liveView,
        productName,
        firmware,
        exposureMode,
        automaticSettings,
        autofocus = true,
        message = connected
            ? exposureMode == "Manual (M)"
                ? $"{productName} connected. Turn the camera dial to P and raise the built-in flash; every photo is verified for flash firing."
                : $"{productName} ready in {exposureMode}. Keep the built-in flash raised; every photo is verified for flash firing."
            : "Canon camera disconnected"
    };
    private void RequireConnected() { if (!connected || camera == IntPtr.Zero) throw new InvalidOperationException("Canon camera is not connected"); }
    private static void Check(uint error, string action) { if (error != Canon.EDS_ERR_OK) throw new InvalidOperationException($"Could not {action}: EDSDK error 0x{error:X8}"); }
    private void ClearPendingCapture() { pendingCaptureId = null; pendingCapturePath = null; }
    private void Respond(string id, object result) => Write(new { type = "response", id, ok = true, result });
    private void RespondError(string id, string error) { if (!string.IsNullOrEmpty(id)) Write(new { type = "response", id, ok = false, error }); }
    private void Write(object value) { lock (outputLock) { Console.Out.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); } }
    public void Dispose() { Disconnect(); GC.KeepAlive(objectHandler); GC.KeepAlive(stateHandler); }
}

internal static class Program
{
    [STAThread]
    private static int Main() => CameraHost.MainLoop();
}
