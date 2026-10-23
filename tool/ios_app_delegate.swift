import CoreNFC
import Flutter
import Foundation
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, NFCNDEFReaderSessionDelegate {
  private struct NfcWriteRequest {
    let url: URL
    let receipt: String?
  }

  private var nfcSession: NFCNDEFReaderSession?
  private var pendingNfcURL: URL?
  private var pendingNfcReceipt: String?
  private var pendingNfcResult: FlutterResult?
  private var queuedDeepLinkNfcURL: URL?
  private var queuedDeepLinkNfcReceipt: String?
  private var nfcWriterChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    var forwardedLaunchOptions = launchOptions
    if let launchURL = launchOptions?[.url] as? URL,
       let request = nfcTarget(fromDeepLink: launchURL) {
      queuedDeepLinkNfcURL = request.url
      queuedDeepLinkNfcReceipt = request.receipt
      // The native writer owns this one custom-scheme launch. Do not also feed it
      // into Flutter deep-link routing, otherwise the Flutter writer screen can
      // start a second NFC session while the native sheet is already opening.
      forwardedLaunchOptions?.removeValue(forKey: .url)
    }

    // Flutter's root view controller is not guaranteed to exist until after the
    // FlutterAppDelegate has completed launch (especially with the modern scene
    // lifecycle). Registering the MethodChannel before this point can silently do
    // nothing and Flutter then reports MissingPluginException.
    let started = super.application(application, didFinishLaunchingWithOptions: forwardedLaunchOptions)
    installNfcWriterChannelIfPossible()
    DispatchQueue.main.async { [weak self] in
      self?.installNfcWriterChannelIfPossible()
      self?.beginQueuedNfcWriteIfPossible()
    }
    // One short retry covers scene/window creation that finishes just after the
    // app delegate launch callback.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      self?.installNfcWriterChannelIfPossible()
      self?.beginQueuedNfcWriteIfPossible()
    }
    return started
  }

  override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    installNfcWriterChannelIfPossible()
    beginQueuedNfcWriteIfPossible()
  }

  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if let request = nfcTarget(fromDeepLink: url) {
      queuedDeepLinkNfcURL = request.url
      queuedDeepLinkNfcReceipt = request.receipt
      DispatchQueue.main.async { [weak self] in
        self?.installNfcWriterChannelIfPossible()
        self?.beginQueuedNfcWriteIfPossible()
      }
      return true
    }
    return super.application(app, open: url, options: options)
  }

  private func installNfcWriterChannelIfPossible() {
    guard nfcWriterChannel == nil else { return }
    guard let controller = activeFlutterViewController() else { return }

    let channel = FlutterMethodChannel(
      name: "saidhere/nfc_writer",
      binaryMessenger: controller.binaryMessenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else {
        result(FlutterError(code: "NFC_WRITER_GONE", message: "The NFC writer is unavailable.", details: nil))
        return
      }
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
      let receipt = (arguments["receipt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
      self.startNfcWrite(url: url, receipt: receipt?.isEmpty == false ? receipt : nil, result: result)
    }
    nfcWriterChannel = channel
  }

  private func activeFlutterViewController() -> FlutterViewController? {
    if let controller = findFlutterViewController(in: window?.rootViewController) {
      return controller
    }

    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for sceneWindow in windowScene.windows {
        if let controller = findFlutterViewController(in: sceneWindow.rootViewController) {
          return controller
        }
      }
    }
    return nil
  }

  private func findFlutterViewController(in controller: UIViewController?) -> FlutterViewController? {
    guard let controller else { return nil }
    if let flutter = controller as? FlutterViewController { return flutter }

    if let navigation = controller as? UINavigationController,
       let flutter = findFlutterViewController(in: navigation.visibleViewController) {
      return flutter
    }
    if let tab = controller as? UITabBarController,
       let flutter = findFlutterViewController(in: tab.selectedViewController) {
      return flutter
    }
    if let presented = controller.presentedViewController,
       let flutter = findFlutterViewController(in: presented) {
      return flutter
    }
    for child in controller.children {
      if let flutter = findFlutterViewController(in: child) { return flutter }
    }
    return nil
  }

  private func nfcTarget(fromDeepLink url: URL) -> NfcWriteRequest? {
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
    let receipt = components.queryItems?
      .first(where: { $0.name == "receipt" })?
      .value?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return NfcWriteRequest(url: target, receipt: receipt?.isEmpty == false ? receipt : nil)
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
    let receipt = queuedDeepLinkNfcReceipt
    queuedDeepLinkNfcURL = nil
    queuedDeepLinkNfcReceipt = nil
    startNfcWrite(url: target, receipt: receipt, result: nil)
  }

  private func startNfcWrite(url: URL, receipt: String?, result: FlutterResult?) {
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
    pendingNfcReceipt = receipt
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

          let receipt = self.pendingNfcReceipt
          guard let receipt, !receipt.isEmpty else {
            session.alertMessage = "The Wall NFC tag was written successfully."
            self.finishNfc(true)
            session.invalidate()
            return
          }

          session.alertMessage = "NFC written. Confirming Tagged status…"
          self.confirmNfcWriteReceipt(receipt) { [weak self] confirmed in
            guard let self else { return }
            DispatchQueue.main.async {
              session.alertMessage = confirmed
                ? "The Wall NFC tag was written and marked Tagged."
                : "The NFC tag was written. Return to Orders and tick Tagged manually."
              self.finishNfc(true)
              session.invalidate()
            }
          }
        }
      }
    }
  }

  private func confirmNfcWriteReceipt(_ receipt: String, completion: @escaping (Bool) -> Void) {
    guard let endpoint = URL(string: "https://saidhere.app/api/fulfilment/nfc-written") else {
      completion(false)
      return
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.timeoutInterval = 12
    do {
      request.httpBody = try JSONSerialization.data(withJSONObject: ["receipt": receipt], options: [])
    } catch {
      completion(false)
      return
    }

    URLSession.shared.dataTask(with: request) { _, response, error in
      guard error == nil,
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode)
      else {
        completion(false)
        return
      }
      completion(true)
    }.resume()
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
    pendingNfcReceipt = nil
    nfcSession = nil
    DispatchQueue.main.async {
      result?(value)
    }
  }

  private func failResult(_ message: String) {
    let result = pendingNfcResult
    pendingNfcResult = nil
    pendingNfcURL = nil
    pendingNfcReceipt = nil
    nfcSession = nil
    DispatchQueue.main.async {
      result?(FlutterError(code: "NFC_WRITE_FAILED", message: message, details: nil))
    }
  }
}
