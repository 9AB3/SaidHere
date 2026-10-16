import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/wall.dart';
import '../models/wall_post.dart';

class SaidHereService {
  SaidHereService(this._client);

  final SupabaseClient _client;

  Future<void> ensureAnonymousSession() async {
    if (_client.auth.currentSession != null) return;
    await _client.auth.signInAnonymously();
  }

  Future<Wall> claimWallVisit(String tagToken) async {
    await ensureAnonymousSession();
    final response = await _client.rpc(
      'claim_wall_visit',
      params: {'p_tag_token': tagToken},
    );

    if (response is! List || response.isEmpty) {
      throw const SaidHereException('This plaque is not active.');
    }

    return Wall.fromMap(Map<String, dynamic>.from(response.first as Map));
  }

  Future<Wall> getWallBySlug(String slug) async {
    await ensureAnonymousSession();
    final response = await _client.rpc(
      'get_discovered_wall',
      params: {'p_slug': slug},
    );

    if (response is! List || response.isEmpty) {
      throw const SaidHereException(
        'You have not discovered this Wall yet. Tap its plaque in person first.',
      );
    }

    return Wall.fromMap(Map<String, dynamic>.from(response.first as Map));
  }

  Future<List<WallPost>> getPosts(String wallId) async {
    await ensureAnonymousSession();
    final data = await _client
        .from('visible_wall_posts')
        .select()
        .eq('wall_id', wallId)
        .order('created_at', ascending: true);

    return (data as List<dynamic>)
        .map((item) => WallPost.fromMap(Map<String, dynamic>.from(item as Map)))
        .toList(growable: false);
  }

  Future<WallPost> createPost({
    required String wallId,
    required String body,
    String? parentId,
  }) async {
    await ensureAnonymousSession();
    final response = await _client.rpc(
      'create_wall_post',
      params: {
        'p_wall_id': wallId,
        'p_body': body.trim(),
        'p_parent_id': parentId,
      },
    );

    if (response is! List || response.isEmpty) {
      throw const SaidHereException('Could not write on this Wall.');
    }

    return WallPost.fromMap(
      Map<String, dynamic>.from(response.first as Map),
    );
  }

  Future<void> reportPost(String postId) async {
    await ensureAnonymousSession();
    await _client.rpc('report_wall_post', params: {'p_post_id': postId});
  }

  Future<List<Wall>> getMyWalls() async {
    await ensureAnonymousSession();
    final response = await _client.rpc('get_my_walls');
    if (response is! List) return [];

    return response
        .map((item) => Wall.fromMap(Map<String, dynamic>.from(item as Map)))
        .toList(growable: false);
  }
}

class SaidHereException implements Exception {
  const SaidHereException(this.message);
  final String message;

  @override
  String toString() => message;
}
