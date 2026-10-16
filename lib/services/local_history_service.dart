import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/wall.dart';

class LocalHistoryService {
  static const _key = 'saidhere_recent_walls';

  Future<void> rememberWall({
    required String slug,
    required String displayName,
    required String locationHint,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    final List<dynamic> items = raw == null ? [] : jsonDecode(raw) as List<dynamic>;

    items.removeWhere((item) => item is Map && item['slug'] == slug);
    items.insert(0, {
      'slug': slug,
      'displayName': displayName,
      'locationHint': locationHint,
      'visitedAt': DateTime.now().toUtc().toIso8601String(),
    });

    if (items.length > 30) {
      items.removeRange(30, items.length);
    }

    await prefs.setString(_key, jsonEncode(items));
  }

  Future<List<Map<String, dynamic>>> recentWalls() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return [];

    final decoded = jsonDecode(raw) as List<dynamic>;
    return decoded
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);
  }

  Future<List<Wall>> cachedWalls() async {
    final items = await recentWalls();
    return items.map((item) {
      final visitedAt = DateTime.tryParse((item['visitedAt'] ?? '').toString())?.toLocal();
      return Wall(
        id: '',
        slug: (item['slug'] ?? '').toString(),
        displayName: (item['displayName'] ?? 'A Wall').toString(),
        locationHint: (item['locationHint'] ?? '').toString(),
        lastVisitedAt: visitedAt,
      );
    }).where((wall) => wall.slug.isNotEmpty).toList(growable: false);
  }
}
