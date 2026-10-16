import 'package:flutter_test/flutter_test.dart';
import 'package:said_here/models/wall.dart';
import 'package:said_here/models/wall_post.dart';

void main() {
  test('wall parses server payload', () {
    final wall = Wall.fromMap({
      'id': '1',
      'slug': 'ABC123',
      'display_name': 'The Wall',
      'location_hint': 'Somewhere in Newcastle',
      'write_access_until': DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String(),
    });
    expect(wall.slug, 'ABC123');
    expect(wall.canWriteNow, isTrue);
  });

  test('post parses reply payload', () {
    final post = WallPost.fromMap({
      'id': '2',
      'wall_id': '1',
      'parent_id': 'root',
      'body': 'It\'s Thursday.',
      'created_at': '2026-10-16T00:00:00Z',
    });
    expect(post.isReply, isTrue);
    expect(post.body, "It's Thursday.");
  });
}
