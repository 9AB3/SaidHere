package app.saidhere.said_here

import android.net.Uri
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.os.Bundle
import android.widget.Toast
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    companion object {
        private const val CHANNEL = "saidhere/nfc_writer"
        private const val RECEIPT_ENDPOINT = "https://saidhere.app/api/fulfilment/nfc-written"
    }

    private var adapter: NfcAdapter? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingUrl: String? = null
    private var pendingReceipt: String? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        adapter = NfcAdapter.getDefaultAdapter(this)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method != "writeUrl") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }

                val url = call.argument<String>("url")?.trim().orEmpty()
                val receipt = call.argument<String>("receipt")?.trim()?.takeIf { it.isNotEmpty() }
                startNfcWrite(url, receipt, result)
            }
    }

    private fun startNfcWrite(url: String, receipt: String?, result: MethodChannel.Result) {
        if (!validWallUrl(url)) {
            result.error("INVALID_URL", "This is not a valid The Wall NFC URL.", null)
            return
        }
        if (pendingResult != null) {
            result.error("NFC_BUSY", "An NFC writing session is already open.", null)
            return
        }

        val currentAdapter = adapter
        if (currentAdapter == null) {
            result.error("NFC_UNAVAILABLE", "NFC writing is not available on this Android phone.", null)
            return
        }
        if (!currentAdapter.isEnabled) {
            result.error("NFC_DISABLED", "Turn on NFC in Android settings and try again.", null)
            return
        }

        pendingResult = result
        pendingUrl = url
        pendingReceipt = receipt

        try {
            currentAdapter.enableReaderMode(
                this,
                ::handleTag,
                NfcAdapter.FLAG_READER_NFC_A or
                    NfcAdapter.FLAG_READER_NFC_B or
                    NfcAdapter.FLAG_READER_NFC_F or
                    NfcAdapter.FLAG_READER_NFC_V,
                Bundle(),
            )
        } catch (error: Exception) {
            finishError("NFC_WRITE_FAILED", error.message ?: "Could not start NFC writing.")
        }
    }

    private fun handleTag(tag: Tag) {
        val url = pendingUrl ?: return
        try {
            val message = NdefMessage(arrayOf(NdefRecord.createUri(url)))
            writeMessage(tag, message)
            val receipt = pendingReceipt
            if (receipt.isNullOrBlank()) {
                finishSuccess()
            } else {
                confirmReceipt(receipt)
            }
        } catch (error: Exception) {
            finishError("NFC_WRITE_FAILED", error.message ?: "Could not write the NFC tag.")
        }
    }

    private fun writeMessage(tag: Tag, message: NdefMessage) {
        val ndef = Ndef.get(tag)
        if (ndef != null) {
            try {
                ndef.connect()
                if (!ndef.isWritable) {
                    throw IllegalStateException("This NFC tag is read-only and cannot be programmed.")
                }
                val bytes = message.toByteArray().size
                if (ndef.maxSize < bytes) {
                    throw IllegalStateException("This NFC tag does not have enough space for The Wall link.")
                }
                ndef.writeNdefMessage(message)
                return
            } finally {
                try {
                    ndef.close()
                } catch (_: Exception) {
                }
            }
        }

        val formatable = NdefFormatable.get(tag)
            ?: throw IllegalStateException("This NFC tag does not support NDEF writing.")
        try {
            formatable.connect()
            formatable.format(message)
        } finally {
            try {
                formatable.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun confirmReceipt(receipt: String) {
        thread(name = "saidhere-nfc-receipt") {
            val confirmed = try {
                val connection = URL(RECEIPT_ENDPOINT).openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 12_000
                    connection.readTimeout = 12_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Accept", "application/json")
                    val body = JSONObject().put("receipt", receipt).toString().toByteArray(Charsets.UTF_8)
                    connection.outputStream.use { it.write(body) }
                    connection.responseCode in 200..299
                } finally {
                    connection.disconnect()
                }
            } catch (_: Exception) {
                false
            }

            if (!confirmed) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "NFC written. Return to Orders and tick Tagged manually.",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            }
            // Match the iOS writer: a successful physical NFC write remains a
            // success even if the optional server receipt confirmation fails.
            finishSuccess()
        }
    }

    private fun validWallUrl(value: String): Boolean {
        return try {
            val uri = Uri.parse(value)
            uri.scheme.equals("https", ignoreCase = true) &&
                uri.host.equals("nfc.saidhere.app", ignoreCase = true) &&
                uri.path?.startsWith("/t/") == true
        } catch (_: Exception) {
            false
        }
    }

    private fun finishSuccess() {
        runOnUiThread {
            stopReaderMode()
            val result = pendingResult
            clearPending()
            result?.success(true)
        }
    }

    private fun finishError(code: String, message: String) {
        runOnUiThread {
            stopReaderMode()
            val result = pendingResult
            clearPending()
            result?.error(code, message, null)
        }
    }

    private fun stopReaderMode() {
        try {
            adapter?.disableReaderMode(this)
        } catch (_: Exception) {
        }
    }

    private fun clearPending() {
        pendingResult = null
        pendingUrl = null
        pendingReceipt = null
    }

    override fun onPause() {
        if (pendingResult != null) {
            finishError("NFC_CANCELLED", "NFC writing was cancelled.")
        }
        super.onPause()
    }

    override fun onDestroy() {
        stopReaderMode()
        clearPending()
        super.onDestroy()
    }
}
