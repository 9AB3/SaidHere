import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'said_here_service.dart';

class DiscoveryLocationService {
  const DiscoveryLocationService();

  Future<bool> captureForWall({
    required SaidHereService service,
    required String wallId,
  }) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return false;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return false;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 8),
        ),
      );

      await service.recordDiscoveryLocation(
        wallId: wallId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMetres: position.accuracy,
      );
      return true;
    } on TimeoutException {
      return false;
    } catch (_) {
      // Location is an optional enhancement. A denied permission, weak GPS fix,
      // or network failure must never prevent the Wall itself from opening.
      return false;
    }
  }
}
