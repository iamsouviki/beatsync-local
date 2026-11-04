import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreGraphics

// Audio-only output. Browser applications are excluded to prevent room feedback.
final class AppAudio: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    var stream: SCStream?
    let queue = DispatchQueue(label: "beatsync.audio")
    let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: 2, interleaved: true)!
    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw NSError(domain: "BeatSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display is available"] ) }
        let excludedIDs = ["com.google.Chrome", "com.apple.Safari", "com.microsoft.edgemac", "org.mozilla.firefox", "com.openai.codex", "com.openai.chat"]
        let excluded = content.applications.filter { app in excludedIDs.contains(where: { app.bundleIdentifier.hasPrefix($0) }) }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000; config.channelCount = 2
        config.width = 2; config.height = 2; config.showsCursor = false
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        FileHandle.standardError.write(Data("READY: Native app audio capture started\n".utf8))
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("ERROR: \(error.localizedDescription)\n".utf8)); exit(1)
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              let format = AVAudioFormat(streamDescription: asbd) else { return }
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0 else { return }
        let list = AudioBufferList.allocate(maximumBuffers: Int(format.channelCount))
        defer { list.unsafeMutablePointer.deallocate() }
        var block: CMBlockBuffer?
        let result = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: list.unsafeMutablePointer, bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: Int(format.channelCount)), blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block)
        guard result == noErr,
              let input = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: list.unsafeMutablePointer, deallocator: nil),
              let converter = AVAudioConverter(from: format, to: outputFormat),
              let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(Double(frames) * 48000 / format.sampleRate) + 32) else { return }
        input.frameLength = AVAudioFrameCount(frames)
        var used = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if used { state.pointee = .noDataNow; return nil }
            used = true; state.pointee = .haveData; return input
        }
        guard status != .error, output.frameLength > 0,
              let bytes = output.audioBufferList.pointee.mBuffers.mData else { return }
        let data = Data(bytes: bytes, count: Int(output.frameLength) * 4)
        let packet: [String: Any] = ["rate": 48000, "channels": 2, "pcm": data.base64EncodedString()]
        if let encoded = try? JSONSerialization.data(withJSONObject: packet) {
            FileHandle.standardOutput.write(encoded); FileHandle.standardOutput.write(Data([10]))
        }
    }
}
@main struct Main {
    static func main() async {
        if CommandLine.arguments.contains("--check-permission") {
            print(CGPreflightScreenCaptureAccess() ? "Screen/system audio permission is available" : "Screen/system audio permission must be granted on first capture")
            return
        }
        let capture = AppAudio()
        do { try await capture.start(); while true { try await Task.sleep(nanoseconds: 3_600_000_000_000) } }
        catch { FileHandle.standardError.write(Data("ERROR: \(error.localizedDescription). Allow BeatSync App Audio in System Settings → Privacy & Security → Screen & System Audio Recording.\n".utf8)); exit(1) }
    }
}
