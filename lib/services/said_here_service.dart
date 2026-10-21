import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../models/wall.dart';
import '../models/wall_post.dart';

class SaidHereService {
  SaidHereService({http.Client? client}) : _http = client ?? http.Client();

  static const _sessionKey = 'saidhere_api_session';
  final http.Client _http;
  Future<String>? _sessionFuture;

  Future<void> ensureAnonymousSession() async {
    await _sessionToken();
  }

  Future<String> _sessionToken() {
    return _sessionFuture ??= _loadOrCreateSession();
  }

  Future<String> _loadOrCreateSession() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_sessionKey);
    if (existing != null && existing.isNotEmpty) return existing;

    final response = await _http.post(
      _uri('/api/session'),
      headers: const {'content-type': 'application/json'},
      body: '{}',
    );
    final data = _decode(response);
    final token = (data['token'] ?? '').toString();
    if (token.isEmpty) {
      throw const SaidHereException('Could not start an anonymous session.');
    }
    await prefs.setString(_sessionKey, token);
    return token;
  }

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<Map<String, String>> _headers() async => {
        'content-type': 'application/json',
        'authorization': 'Bearer ${await _sessionToken()}',
      };

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
    final response = await _http.post(
      _uri('/api/tags/open'),
      headers: await _headers(),
      body: jsonEncode({'token': tagToken}),
    );
    final data = _decode(response);
    return Wall.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<Wall> getWallBySlug(String slug) async {
    final response = await _http.get(
      _uri('/api/walls/${Uri.encodeComponent(slug)}'),
      headers: await _headers(),
    );
    final data = _decode(response);
    return Wall.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<List<WallPost>> getPosts(String wallId) async {
    final response = await _http.get(
      _uri('/api/walls/${Uri.encodeComponent(wallId)}/posts'),
      headers: await _headers(),
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
    final response = await _http.post(
      _uri('/api/walls/${Uri.encodeComponent(wallId)}/posts'),
      headers: await _headers(),
      body: jsonEncode({
        'body': body.trim(),
        'parent_id': parentId,
      }),
    );
    final data = _decode(response);
    return WallPost.fromMap(Map<String, dynamic>.from(data as Map));
  }

  Future<void> reportPost(String postId) async {
    final response = await _http.post(
      _uri('/api/posts/${Uri.encodeComponent(postId)}/report'),
      headers: await _headers(),
      body: '{}',
    );
    _decode(response);
  }

  Future<List<Wall>> getMyWalls() async {
    final response = await _http.get(
      _uri('/api/walls'),
      headers: await _headers(),
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
