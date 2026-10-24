class WallDiscovery {
  const WallDiscovery({
    required this.wallId,
    required this.latitude,
    required this.longitude,
    required this.scannedAt,
    required this.scanCount,
    required this.suburb,
    this.accuracyMetres,
  });

  final String wallId;
  final double latitude;
  final double longitude;
  final double? accuracyMetres;
  final DateTime scannedAt;
  final int scanCount;
  final String suburb;

  factory WallDiscovery.fromMap(Map<String, dynamic> map) {
    double number(dynamic value) => value is num
        ? value.toDouble()
        : double.tryParse(value?.toString() ?? '') ?? 0;
    return WallDiscovery(
      wallId: (map['wall_id'] ?? '').toString(),
      latitude: number(map['latitude']),
      longitude: number(map['longitude']),
      accuracyMetres: map['accuracy_metres'] == null
          ? null
          : number(map['accuracy_metres']),
      scannedAt: DateTime.tryParse((map['scanned_at'] ?? '').toString())?.toLocal() ??
          DateTime.now(),
      scanCount: int.tryParse((map['scan_count'] ?? '1').toString()) ?? 1,
      suburb: (map['suburb'] ?? '').toString().trim(),
    );
  }
}
