import 'dart:async';

import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

import 'discovery_api_service.dart';

class DiscoveryLocationService {
  const DiscoveryLocationService();

  Future<bool> captureForWall({
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

      var suburb = '';
      try {
        final placemarks = await placemarkFromCoordinates(
          position.latitude,
          position.longitude,
        ).timeout(const Duration(seconds: 5));
        if (placemarks.isNotEmpty) {
          final place = placemarks.first;
          final locality = (place.locality ?? '').trim();
          final subLocality = (place.subLocality ?? '').trim();
          final adminArea = (place.subAdministrativeArea ?? '').trim();
          suburb = locality.isNotEmpty
              ? locality
              : subLocality.isNotEmpty
                  ? subLocality
                  : adminArea;
        }
      } catch (_) {
        // A missing reverse-geocode must not prevent the scan coordinates from
        // being saved. The map can still show the exact discovery point.
      }

      await DiscoveryApiService().record(
        wallId: wallId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMetres: position.accuracy,
        suburb: suburb,
      );
      return true;
    } on TimeoutException {
      return false;
    } catch (_) {
      // Location is an optional enhancement. A denied permission, weak GPS fix,
      // reverse-geocode failure, or network failure must never prevent the Wall
      // itself from opening.
      return false;
    }
  }
}
