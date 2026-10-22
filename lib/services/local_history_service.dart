import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/wall.dart';

class LocalHistoryService {
  static const _key = 'saidhere_recent_walls';

  Future<List<dynamic>> _loadItems(SharedPreferences prefs) async {
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return <dynamic>[];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List<dynamic>) return decoded;
    } catch (_) {
      // A partial/corrupt local write should never make the history screen unusable.
    }
    await prefs.remove(_key);
    return <dynamic>[];
  }

  Future<void> rememberWall({
    required String slug,
    required String displayName,
    required String locationHint,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final items = await _loadItems(prefs);

    items.removeWhere((item) => item is Map && item['slug'] == slug);
    items.insert(0, {
      'slug': slug,
      'displayName': displayName,
      'locationHint': locationHint,
      'visitedAt': DateTime.now().toUtc().toIso8601String(),
    });

    if (items.length > 30) items.removeRange(30, items.length);
    await prefs.setString(_key, jsonEncode(items));
  }

  Future<List<Map<String, dynamic>>> recentWalls() async {
    final prefs = await SharedPreferences.getInstance();
    final decoded = await _loadItems(prefs);
    return decoded
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
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
