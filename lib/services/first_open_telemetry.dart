import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'said_here_service.dart';

/// Records one first open per installation. Never interrupts ordinary app use.
class FirstOpenTelemetry {
  static const _stateKey = 'saidhere_first_open_telemetry_v1';
  static const _sessionKey = 'saidhere_api_session';

  String? get _platform {
    if (kIsWeb) return null;
    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'ios',
      TargetPlatform.android => 'android',
      _ => null,
    };
  }

  /// Decide before rendering app screens, preventing a race with session setup.
  /// An older installation that already has a session is not counted as new.
  Future<bool> shouldReport() async {
    if (_platform == null) return false;
    try {
      final prefs = await SharedPreferences.getInstance();
      final state = prefs.getString(_stateKey);
      if (state == 'sent' || state == 'legacy') return false;
      if (state == null) {
        final existingSession = prefs.getString(_sessionKey);
        if (existingSession != null && existingSession.isNotEmpty) {
          await prefs.setString(_stateKey, 'legacy');
          return false;
        }
        // Persist pending *before* sending, so failed/offline sends are retried.
        await prefs.setString(_stateKey, 'pending');
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> report() async {
    final platform = _platform;
    if (platform == null) return;
    try {
      await SaidHereService().reportFirstOpen(platform: platform);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_stateKey, 'sent');
    } catch (_) {
      // Keep pending; try again next time the app is opened.
    }
  }
}
