import CoreNFC
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, NFCNDEFReaderSessionDelegate {
  private var nfcSession: NFCNDEFReaderSession?
  private var pendingNfcURL: URL?
  private var pendingNfcResult: FlutterResult?

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
        guard NFCNDEFReaderSession.readingAvailable else {
          result(FlutterError(
            code: "NFC_UNAVAILABLE",
            message: "NFC writing is not available on this iPhone.",
            details: nil
          ))
          return
        }
        guard self.pendingNfcResult == nil else {
          result(FlutterError(
            code: "NFC_BUSY",
            message: "An NFC writing session is already open.",
            details: nil
          ))
          return
        }
        guard
          let arguments = call.arguments as? [String: Any],
          let value = arguments["url"] as? String,
          let url = URL(string: value),
          url.scheme?.lowercased() == "https",
          url.host?.lowercased() == "nfc.saidhere.app",
          url.path.hasPrefix("/t/")
        else {
          result(FlutterError(
            code: "INVALID_URL",
            message: "This is not a valid The Wall NFC URL.",
            details: nil
          ))
          return
        }

        self.pendingNfcURL = url
        self.pendingNfcResult = result
        let session = NFCNDEFReaderSession(
          delegate: self,
          queue: nil,
          invalidateAfterFirstRead: false
        )
        session.alertMessage = "Hold the top of your iPhone near the blank Wall NFC tag."
        self.nfcSession = session
        session.begin()
      }
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

  func readerSession(
    _ session: NFCNDEFReaderSession,
    didDetectNDEFs messages: [NFCNDEFMessage]
  ) {
    // The read/write delegate callback below is used instead.
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
    guard pendingNfcResult != nil else { return }
    let nsError = error as NSError
    if nsError.domain == NFCReaderError.errorDomain,
       nsError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue {
      failResult("NFC writing was cancelled.")
    } else {
      failResult(error.localizedDescription)
    }
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
