import CoreNFC
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, NFCNDEFReaderSessionDelegate {
  private var nfcSession: NFCNDEFReaderSession?
  private var pendingNfcURL: URL?
  private var pendingNfcResult: FlutterResult?
  private var queuedDeepLinkNfcURL: URL?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "saidhere/nfc_writer",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        guard let self else { return }
        guard call.method == "writeUrl" else {
          result(FlutterMethodNotImplemented)
          return
        }
        guard
          let arguments = call.arguments as? [String: Any],
          let value = arguments["url"] as? String,
          let url = URL(string: value)
        else {
          result(FlutterError(
            code: "INVALID_URL",
            message: "This is not a valid The Wall NFC URL.",
            details: nil
          ))
          return
        }
        self.startNfcWrite(url: url, result: result)
      }
    }

    var forwardedLaunchOptions = launchOptions
    if let launchURL = launchOptions?[.url] as? URL,
       let target = nfcTarget(fromDeepLink: launchURL) {
      queuedDeepLinkNfcURL = target
      // The native writer owns this one custom-scheme launch. Do not also feed it
      // into Flutter deep-link routing, otherwise the Flutter writer screen can
      // start a second NFC session while the native sheet is already opening.
      forwardedLaunchOptions?.removeValue(forKey: .url)
    }

    let started = super.application(application, didFinishLaunchingWithOptions: forwardedLaunchOptions)
    DispatchQueue.main.async { [weak self] in
      self?.beginQueuedNfcWriteIfPossible()
    }
    return started
  }

  override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    beginQueuedNfcWriteIfPossible()
  }

  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if let target = nfcTarget(fromDeepLink: url) {
      queuedDeepLinkNfcURL = target
      DispatchQueue.main.async { [weak self] in
        self?.beginQueuedNfcWriteIfPossible()
      }
      return true
    }
    return super.application(app, open: url, options: options)
  }

  private func nfcTarget(fromDeepLink url: URL) -> URL? {
    guard url.scheme?.lowercased() == "saidhere" else { return nil }
    let host = (url.host ?? "").lowercased()
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
    guard host == "write-nfc" || path == "write-nfc" else { return nil }
    guard
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let value = components.queryItems?.first(where: { $0.name == "value" })?.value,
      let target = URL(string: value),
      validWallNfcURL(target)
    else { return nil }
    return target
  }

  private func validWallNfcURL(_ url: URL) -> Bool {
    url.scheme?.lowercased() == "https" &&
      url.host?.lowercased() == "nfc.saidhere.app" &&
      url.path.hasPrefix("/t/")
  }

  private func beginQueuedNfcWriteIfPossible() {
    guard UIApplication.shared.applicationState == .active else { return }
    guard nfcSession == nil, pendingNfcURL == nil else { return }
    guard let target = queuedDeepLinkNfcURL else { return }
    queuedDeepLinkNfcURL = nil
    startNfcWrite(url: target, result: nil)
  }

  private func startNfcWrite(url: URL, result: FlutterResult?) {
    guard validWallNfcURL(url) else {
      result?(FlutterError(
        code: "INVALID_URL",
        message: "This is not a valid The Wall NFC URL.",
        details: nil
      ))
      return
    }
    guard NFCNDEFReaderSession.readingAvailable else {
      result?(FlutterError(
        code: "NFC_UNAVAILABLE",
        message: "NFC writing is not available on this iPhone.",
        details: nil
      ))
      return
    }
    guard nfcSession == nil, pendingNfcURL == nil else {
      result?(FlutterError(
        code: "NFC_BUSY",
        message: "An NFC writing session is already open.",
        details: nil
      ))
      return
    }

    pendingNfcURL = url
    pendingNfcResult = result
    let session = NFCNDEFReaderSession(
      delegate: self,
      queue: nil,
      invalidateAfterFirstRead: false
    )
    session.alertMessage = "Hold the top of your iPhone near the blank Wall NFC tag."
    nfcSession = session
    session.begin()
  }

  func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

  func readerSession(
    _ session: NFCNDEFReaderSession,
    didDetectNDEFs messages: [NFCNDEFMessage]
  ) {
    // The read/write tag callback below is used instead.
  }

  func readerSession(
    _ session: NFCNDEFReaderSession,
    didDetect tags: [NFCNDEFTag]
  ) {
    guard tags.count == 1, let tag = tags.first else {
      session.alertMessage = "More than one NFC tag was detected. Move the others away and try again."
      DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
        session.restartPolling()
      }
      return
    }

    session.connect(to: tag) { [weak self] error in
      guard let self else { return }
      if let error {
        self.failNfc(session, message: error.localizedDescription)
        return
      }

      tag.queryNDEFStatus { [weak self] status, _, error in
        guard let self else { return }
        if let error {
          self.failNfc(session, message: error.localizedDescription)
          return
        }
        guard status == .readWrite else {
          let message = status == .readOnly
            ? "This NFC tag is read-only and cannot be programmed."
            : "This NFC tag does not support NDEF writing."
          self.failNfc(session, message: message)
          return
        }
        guard
          let url = self.pendingNfcURL,
          let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: url)
        else {
          self.failNfc(session, message: "Could not create the Wall NFC message.")
          return
        }

        let message = NFCNDEFMessage(records: [payload])
        tag.writeNDEF(message) { [weak self] error in
          guard let self else { return }
          if let error {
            self.failNfc(session, message: error.localizedDescription)
            return
          }
          session.alertMessage = "The Wall NFC tag was written successfully."
          self.finishNfc(true)
          session.invalidate()
        }
      }
    }
  }

  func readerSession(
    _ session: NFCNDEFReaderSession,
    didInvalidateWithError error: Error
  ) {
    guard pendingNfcURL != nil else { return }
    failResult(error.localizedDescription)
  }

  private func failNfc(_ session: NFCNDEFReaderSession, message: String) {
    session.invalidate(errorMessage: message)
    failResult(message)
  }

  private func finishNfc(_ value: Bool) {
    let result = pendingNfcResult
    pendingNfcResult = nil
    pendingNfcURL = nil
    nfcSession = nil
    DispatchQueue.main.async {
      result?(value)
    }
  }

  private func failResult(_ message: String) {
    let result = pendingNfcResult
    pendingNfcResult = nil
    pendingNfcURL = nil
    nfcSession = nil
    DispatchQueue.main.async {
      result?(FlutterError(code: "NFC_WRITE_FAILED", message: message, details: nil))
    }
  }
}
