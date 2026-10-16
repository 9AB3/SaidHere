import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:said_here/models/wall.dart';
import 'package:said_here/models/wall_post.dart';
import 'package:said_here/services/local_history_service.dart';

void main() {
  test('wall parses active server write window', () {
    final wall = Wall.fromMap({
      'id': '1',
      'slug': 'ABC123',
      'display_name': 'The Wall',
      'location_hint': 'Somewhere in Newcastle',
      'write_access_until': DateTime.now()
          .add(const Duration(minutes: 10))
          .toUtc()
          .toIso8601String(),
    });
    expect(wall.slug, 'ABC123');
    expect(wall.canWriteNow, isTrue);
  });

  test('wall write window expires locally', () {
    final wall = Wall.fromMap({
      'id': '1',
      'slug': 'ABC123',
      'display_name': 'The Wall',
      'location_hint': '',
      'write_access_until': DateTime.now()
          .subtract(const Duration(seconds: 1))
          .toUtc()
          .toIso8601String(),
    });
    expect(wall.canWriteNow, isFalse);
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

  test('local history remembers and returns cached Walls newest first', () async {
    SharedPreferences.setMockInitialValues({});
    final history = LocalHistoryService();

    await history.rememberWall(
      slug: 'ONE',
      displayName: 'First Wall',
      locationHint: 'Singleton NSW',
    );
    await history.rememberWall(
      slug: 'TWO',
      displayName: 'Second Wall',
      locationHint: 'Newcastle NSW',
    );

    final walls = await history.cachedWalls();
    expect(walls, hasLength(2));
    expect(walls.first.slug, 'TWO');
    expect(walls.first.displayName, 'Second Wall');
    expect(walls.last.slug, 'ONE');
  });
}
