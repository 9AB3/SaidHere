import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../models/wall.dart';
import '../models/wall_post.dart';

class FirstScanSetup {
  const FirstScanSetup({
    required this.setupRequired,
    required this.accountActive,
    this.serialCode,
  });

  final bool setupRequired;
  final bool accountActive;
  final String? serialCode;

  factory FirstScanSetup.fromMap(Map<String, dynamic> map) {
    return FirstScanSetup(
      setupRequired: map['setup_required'] == true,
      accountActive: map['account_active'] == true,
      serialCode: map['serial_code']?.toString(),
    );
  }
}

class SaidHereService {
  SaidHereService({http.Client? client}) : _http = client ?? http.Client();

  static const _sessionKey = 'saidhere_api_session';
  // Render's free service can take well over 50 seconds to wake from sleep.
  // A shorter timeout makes the first app request look broken even though the
  // service is only cold-starting.
  static const _requestTimeout = Duration(seconds: 75);

  final http.Client _http;
  Future<String>? _sessionFuture;

  Future<void> ensureAnonymousSession() async {
    await _sessionToken();
  }

  Future<String> _sessionToken() async {
    final current = _sessionFuture;
    if (current != null) return current;

    final future = _loadOrCreateSession();
    _sessionFuture = future;
    try {
      return await future;
    } catch (_) {
      if (identical(_sessionFuture, future)) _sessionFuture = null;
      rethrow;
    }
  }

  Future<String> _loadOrCreateSession() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_sessionKey);
    if (existing != null && existing.isNotEmpty) return existing;

    try {
      final response = await _http
          .post(
            _uri('/api/session'),
            headers: const {'content-type': 'application/json'},
            body: '{}',
          )
          .timeout(_requestTimeout);
      final data = _decode(response);
      final token = (data['token'] ?? '').toString();
      if (token.isEmpty) {
        throw const SaidHereException('Could not start an anonymous session.');
      }
      await prefs.setString(_sessionKey, token);
      return token;
    } on TimeoutException {
      throw const SaidHereException('The Wall is taking too long to respond. Try again.');
    }
  }

  Future<void> _resetSession() async {
    _sessionFuture = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
  }

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<http.Response> _authorized(
    Future<http.Response> Function(Map<String, String> headers) request,
  ) async {
    for (var attempt = 0; attempt < 2; attempt += 1) {
      final token = await _sessionToken();
      try {
        final response = await request({
          'content-type': 'application/json',
          'authorization': 'Bearer $token',
        }).timeout(_requestTimeout);
        if (response.statusCode != 401 || attempt == 1) return response;
        await _resetSession();
      } on TimeoutException {
        throw const SaidHereException('The Wall is taking too long to respond. Try again.');
      }
    }
    throw const SaidHereException('Could not restore your anonymous session.');
  }

  dynamic _decode(http.Response response) {
    dynamic data;
    if (response.body.isNotEmpty) {
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        data = null;
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final map = data is Map<String, dynamic> ? data : null;
      final message = map != null
          ? (map['error'] ?? 'Request failed.').toString()
          : 'Request failed (${response.statusCode}).';
      throw SaidHereException(
        message,
        setupRequired: map?['setup_required'] == true,
        setupUrl: map?['setup_url']?.toString(),
      );
    }
    return data;
  }

  Future<Wall> claimWallVisit(String tagToken) async {
    final response = await _authorized(
      (headers) => _http.post(
        _uri('/api/tags/open'),
        headers: headers,
        body: jsonEncode({'token': tagToken}),
      ),
    );
    final data = _decode(response);
    return Wall.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<FirstScanSetup> getFirstScanSetup(String tagToken) async {
    final response = await _authorized(
      (headers) => _http.post(
        _uri('/api/tags/setup/status'),
        headers: headers,
        body: jsonEncode({'token': tagToken}),
      ),
    );
    final data = _decode(response);
    return FirstScanSetup.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<Wall> completeFirstScanSetup({
    required String tagToken,
    required String displayName,
    required String locationHint,
    required String email,
    required String password,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _uri('/api/tags/setup'),
        headers: headers,
        body: jsonEncode({
          'token': tagToken,
          'display_name': displayName.trim(),
          'location_hint': locationHint.trim(),
          'email': email.trim(),
          'password': password,
        }),
      ),
    );
    final data = _decode(response);
    return Wall.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<Wall> getWallBySlug(String slug) async {
    final response = await _authorized(
      (headers) => _http.get(
        _uri('/api/walls/${Uri.encodeComponent(slug)}'),
        headers: headers,
      ),
    );
    final data = _decode(response);
    return Wall.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<List<WallPost>> getPosts(String wallId) async {
    final response = await _authorized(
      (headers) => _http.get(
        _uri('/api/walls/${Uri.encodeComponent(wallId)}/posts'),
        headers: headers,
      ),
    );
    final data = _decode(response);
    if (data is! List) return [];
    return data
        .map((item) => WallPost.fromMap(Map<String, dynamic>.from(item as Map)))
        .toList(growable: false);
  }

  Future<WallPost> createPost({
    required String wallId,
    required String body,
    String? parentId,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _uri('/api/walls/${Uri.encodeComponent(wallId)}/posts'),
        headers: headers,
        body: jsonEncode({
          'body': body.trim(),
          'parent_id': parentId,
        }),
      ),
    );
    final data = _decode(response);
    return WallPost.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<void> reportPost(String postId) async {
    final response = await _authorized(
      (headers) => _http.post(
        _uri('/api/posts/${Uri.encodeComponent(postId)}/report'),
        headers: headers,
        body: '{}',
      ),
    );
    _decode(response);
  }

  Future<List<Wall>> getMyWalls() async {
    final response = await _authorized(
      (headers) => _http.get(_uri('/api/walls'), headers: headers),
    );
    final data = _decode(response);
    if (data is! List) return [];
    return data
        .map((item) => Wall.fromMap(Map<String, dynamic>.from(item as Map)))
        .toList(growable: false);
  }
}

class SaidHereException implements Exception {
  const SaidHereException(
    this.message, {
    this.setupRequired = false,
    this.setupUrl,
  });

  final String message;
  final bool setupRequired;
  final String? setupUrl;

  @override
  String toString() => message;
}
