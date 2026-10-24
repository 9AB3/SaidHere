import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../models/wall_discovery.dart';

class DiscoveryApiService {
  DiscoveryApiService({http.Client? client}) : _http = client ?? http.Client();

  static const _sessionKey = 'saidhere_api_session';
  static const _timeout = Duration(seconds: 20);
  final http.Client _http;

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_sessionKey);
    return token == null || token.isEmpty ? null : token;
  }

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<Map<String, String>?> _headers() async {
    final token = await _token();
    if (token == null) return null;
    return {
      'content-type': 'application/json',
      'authorization': 'Bearer $token',
    };
  }

  Future<void> record({
    required String wallId,
    required double latitude,
    required double longitude,
    required double accuracyMetres,
    required String suburb,
  }) async {
    final headers = await _headers();
    if (headers == null) return;
    final response = await _http
        .post(
          _uri('/api/walls/${Uri.encodeComponent(wallId)}/location'),
          headers: headers,
          body: jsonEncode({
            'latitude': latitude,
            'longitude': longitude,
            'accuracy_metres': accuracyMetres,
            'suburb': suburb.trim(),
          }),
        )
        .timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Could not save discovery location.');
    }
  }

  Future<List<WallDiscovery>> getDiscoveries() async {
    final headers = await _headers();
    if (headers == null) return const [];
    final response = await _http
        .get(_uri('/api/discovery-locations'), headers: headers)
        .timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) return const [];
    final decoded = jsonDecode(response.body);
    if (decoded is! List) return const [];
    return decoded
        .whereType<Map>()
        .map((item) => WallDiscovery.fromMap(Map<String, dynamic>.from(item)))
        .where((item) => item.wallId.isNotEmpty)
        .toList(growable: false);
  }
}
