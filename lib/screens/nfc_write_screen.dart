import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class NfcWriteScreen extends StatefulWidget {
  const NfcWriteScreen({required this.url, this.receipt, super.key});

  final String url;
  final String? receipt;

  @override
  State<NfcWriteScreen> createState() => _NfcWriteScreenState();
}

class _NfcWriteScreenState extends State<NfcWriteScreen> {
  static const _channel = MethodChannel('saidhere/nfc_writer');

  bool _started = false;
  bool _writing = false;
  bool _success = false;
  String? _error;

  bool get _validUrl {
    final uri = Uri.tryParse(widget.url);
    return uri != null &&
        uri.scheme == 'https' &&
        uri.host == 'nfc.saidhere.app' &&
        uri.pathSegments.length >= 2 &&
        uri.pathSegments.first == 't';
  }

  bool get _hasReceipt => (widget.receipt ?? '').trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_started) _write();
    });
  }

  Future<bool?> _invokeNativeWriter() async {
    const attempts = 8;
    for (var attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await _channel.invokeMethod<bool>(
          'writeUrl',
          <String, Object?>{
            'url': widget.url,
            if (_hasReceipt) 'receipt': widget.receipt!.trim(),
          },
        );
      } on MissingPluginException {
        if (attempt == attempts - 1) rethrow;
        await Future<void>.delayed(
          Duration(milliseconds: 120 + (attempt * 80)),
        );
      }
    }
    return false;
  }

  Future<void> _write() async {
    if (_writing) return;
    _started = true;
    if (!_validUrl) {
      setState(() {
        _error = 'This NFC write link is not valid for The Wall.';
        _success = false;
      });
      return;
    }

    setState(() {
      _writing = true;
      _success = false;
      _error = null;
    });

    try {
      final written = await _invokeNativeWriter();
      if (!mounted) return;
      setState(() {
        _writing = false;
        _success = written == true;
        if (written != true) _error = 'The NFC tag was not written.';
      });
    } on PlatformException catch (error) {
      if (!mounted) return;
      setState(() {
        _writing = false;
        _success = false;
        _error = error.message ?? 'Could not write the NFC tag.';
      });
    } on MissingPluginException {
      if (!mounted) return;
      setState(() {
        _writing = false;
        _success = false;
        _error = 'The native NFC writer did not start. Close The Wall, reopen it, and try Write NFC again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final payload = widget.url.replaceFirst('https://', '');
    return Scaffold(
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 430),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8DCC8),
                    border: Border.all(
                      color: SaidHereTheme.ink.withValues(alpha: .5),
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x44000000),
                        offset: Offset(4, 5),
                        blurRadius: 0,
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: const BoxDecoration(
                          color: SaidHereTheme.ink,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          _success ? Icons.check : Icons.nfc,
                          color: const Color(0xFFF5EBDC),
                          size: 34,
                        ),
                      ),
                      const SizedBox(height: 17),
                      Text(
                        _success
                            ? 'NFC TAG WRITTEN'
                            : _writing
                                ? 'READY TO WRITE'
                                : 'WRITE WALL NFC',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: SaidHereTheme.ink,
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .3,
                        ),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        _success
                            ? (_hasReceipt
                                ? 'The Wall link has been written successfully. If automatic Tagged confirmation fails, mark it manually in Orders.'
                                : 'The Wall link has been written successfully. Return to Orders and tick Tagged.')
                            : _writing
                                ? 'The NFC writer is ready. Hold the NFC area of this phone against the blank Wall tag until the write completes.'
                                : (_error ?? 'Tap below to start the NFC writer.'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: SaidHereTheme.ink,
                          height: 1.45,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(11),
                        color: const Color(0x22FFFFFF),
                        child: Text(
                          payload,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: SaidHereTheme.ink,
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                      ),
                      if (_writing) ...[
                        const SizedBox(height: 20),
                        const CircularProgressIndicator(color: SaidHereTheme.ink),
                      ] else ...[
                        const SizedBox(height: 18),
                        if (!_success)
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: _write,
                              icon: const Icon(Icons.nfc),
                              label: const Text('WRITE NFC TAG'),
                            ),
                          ),
                        const SizedBox(height: 8),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton(
                            onPressed: () => context.go('/'),
                            child: Text(_success ? 'DONE' : 'CANCEL'),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
