import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:said_here/services/said_here_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('creates one anonymous session and reuses it', () async {
    var sessionCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/api/session') {
        sessionCalls += 1;
        return http.Response(jsonEncode({'token': 'session-token'}), 201,
            headers: {'content-type': 'application/json'});
      }
      if (request.url.path == '/api/walls') {
        expect(request.headers['authorization'], 'Bearer session-token');
        return http.Response('[]', 200,
            headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });

    final service = SaidHereService(client: client);
    await service.getMyWalls();
    await service.getMyWalls();

    expect(sessionCalls, 1);
  });

  test('reuses a persisted anonymous session without creating a new one', () async {
    SharedPreferences.setMockInitialValues({
      'saidhere_api_session': 'existing-session',
    });

    final client = MockClient((request) async {
      expect(request.url.path, '/api/walls');
      expect(request.headers['authorization'], 'Bearer existing-session');
      return http.Response('[]', 200,
          headers: {'content-type': 'application/json'});
    });

    final service = SaidHereService(client: client);
    await service.getMyWalls();
  });

  test('plaque claim sends token and returns write access', () async {
    SharedPreferences.setMockInitialValues({
      'saidhere_api_session': 'session-token',
    });
    final expiry = DateTime.now().add(const Duration(minutes: 10)).toUtc();

    final client = MockClient((request) async {
      expect(request.url.path, '/api/tags/open');
      expect(request.method, 'POST');
      expect(request.headers['authorization'], 'Bearer session-token');
      expect(jsonDecode(request.body)['token'], 'plaque-token');
      return http.Response(
        jsonEncode({
          'id': 'wall-1',
          'slug': 'ABC123',
          'display_name': 'Test Wall',
          'location_hint': 'Singleton NSW',
          'write_access_until': expiry.toIso8601String(),
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final wall = await SaidHereService(client: client).claimWallVisit('plaque-token');
    expect(wall.slug, 'ABC123');
    expect(wall.canWriteNow, isTrue);
  });

  test('server error text is surfaced to the UI layer', () async {
    SharedPreferences.setMockInitialValues({
      'saidhere_api_session': 'session-token',
    });

    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({'error': 'Writing time has expired. Tap this Wall again in person to write.'}),
        403,
        headers: {'content-type': 'application/json'},
      );
    });

    final service = SaidHereService(client: client);
    expect(
      () => service.createPost(wallId: 'wall-1', body: 'Hello'),
      throwsA(
        isA<SaidHereException>().having(
          (error) => error.message,
          'message',
          contains('Writing time has expired'),
        ),
      ),
    );
  });
}
