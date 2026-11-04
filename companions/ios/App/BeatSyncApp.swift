import SwiftUI
import ReplayKit
@main struct BeatSyncPhone: App {var body: some Scene {WindowGroup {ContentView()}}}
struct ContentView: View {
 @State private var address=""
 @State private var code=""
 @State private var saved=false
 var body: some View {VStack(spacing:24){Text("BeatSync · Wi-Fi app audio").font(.title);TextField("Mac URL",text:$address).textInputAutocapitalization(.never).autocorrectionDisabled();TextField("Room code",text:$code).textInputAutocapitalization(.characters);Button("Save room connection"){guard URL(string:address)?.host != nil, code.count==6 else{return};let d=UserDefaults(suiteName:"group.local.beatsync.phone")!;d.set(address,forKey:"url");d.set(code.uppercased(),forKey:"room");saved=true};if saved{Text("Tap the broadcast button, start BeatSync, then open your music app.");Picker().frame(width:70,height:70)};Text("Only app audio is uploaded. Microphone and video samples are discarded. Protected audio may be unavailable. Stop with the iPhone broadcast indicator.").font(.footnote)}.padding(30)}
}
struct Picker: UIViewRepresentable {func makeUIView(context:Context)->RPSystemBroadcastPickerView{let v=RPSystemBroadcastPickerView(frame:.zero);v.preferredExtension="local.beatsync.BeatSyncPhone.Broadcast";v.showsMicrophoneButton=false;return v};func updateUIView(_ v:RPSystemBroadcastPickerView,context:Context){}}
