class Wall {
  const Wall({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.locationHint,
    this.firstDiscoveredAt,
    this.lastVisitedAt,
    this.writeAccessUntil,
  });

  final String id;
  final String slug;
  final String displayName;
  final String locationHint;
  final DateTime? firstDiscoveredAt;
  final DateTime? lastVisitedAt;
  final DateTime? writeAccessUntil;

  bool get canWriteNow =>
      writeAccessUntil != null && writeAccessUntil!.isAfter(DateTime.now());

  factory Wall.fromMap(Map<String, dynamic> map) {
    DateTime? parse(dynamic value) => value == null
        ? null
        : DateTime.tryParse(value.toString())?.toLocal();

    return Wall(
      id: map['id'].toString(),
      slug: (map['slug'] ?? '').toString(),
      displayName: (map['display_name'] ?? 'A Wall').toString(),
      locationHint: (map['location_hint'] ?? '').toString(),
      firstDiscoveredAt: parse(map['first_discovered_at']),
      lastVisitedAt: parse(map['last_visited_at']),
      writeAccessUntil: parse(map['write_access_until']),
    );
  }

  Wall copyWith({
    DateTime? firstDiscoveredAt,
    DateTime? lastVisitedAt,
    DateTime? writeAccessUntil,
  }) {
    return Wall(
      id: id,
      slug: slug,
      displayName: displayName,
      locationHint: locationHint,
      firstDiscoveredAt: firstDiscoveredAt ?? this.firstDiscoveredAt,
      lastVisitedAt: lastVisitedAt ?? this.lastVisitedAt,
      writeAccessUntil: writeAccessUntil ?? this.writeAccessUntil,
    );
  }
}
