import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../config/app_config.dart';
import '../config/ui_assets.dart';
import '../models/wall.dart';
import '../models/wall_discovery.dart';
import '../services/discovery_api_service.dart';
import '../services/local_history_service.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class DiscoveredWallsScreen extends StatefulWidget {
  const DiscoveredWallsScreen({
    required this.service,
    required this.localHistory,
    super.key,
  });

  final SaidHereService service;
  final LocalHistoryService localHistory;

  @override
  State<DiscoveredWallsScreen> createState() => _DiscoveredWallsScreenState();
}

class _DiscoveredWallsScreenState extends State<DiscoveredWallsScreen> {
  late Future<_FoundResult> _future;
  bool _showMap = true;
  BitmapDescriptor? _plaqueMarker;
  bool _loadingMarker = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadMarker();
  }

  Future<void> _loadMarker() async {
    if (_plaqueMarker != null || _loadingMarker) return;
    _loadingMarker = true;
    try {
      final icon = await BitmapDescriptor.asset(
        createLocalImageConfiguration(context, size: const Size(52, 52)),
        'lib/267ABF9F-A613-4DD2-B026-87B6C2B6AEBD.png',
      );
      if (mounted) setState(() => _plaqueMarker = icon);
    } catch (_) {
      // Fall back to the standard marker if the asset cannot be prepared.
    } finally {
      _loadingMarker = false;
    }
  }

  Future<_FoundResult> _load() async {
    List<WallDiscovery> discoveries = const [];
    try {
      discoveries = await DiscoveryApiService().getDiscoveries();
    } catch (_) {}

    try {
      final walls = await widget.service.getMyWalls();
      return _FoundResult(walls, discoveries: discoveries, fromCache: false);
    } catch (error) {
      final cached = await widget.localHistory.cachedWalls();
      if (cached.isNotEmpty) {
        return _FoundResult(
          cached,
          discoveries: discoveries,
          fromCache: true,
          warning: error.toString(),
        );
      }
      rethrow;
    }
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: _NavDisc(
          icon: Icons.arrow_back,
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const SizedBox.shrink(),
        actions: [
          _NavDisc(icon: Icons.refresh, onPressed: _refresh),
          const SizedBox(width: 10),
        ],
      ),
      body: WallBackground(
        child: SafeArea(
          child: FutureBuilder<_FoundResult>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return _ErrorState(message: snapshot.error.toString(), onRetry: _refresh);
              }
              final result = snapshot.data ?? const _FoundResult([]);
              return _content(result);
            },
          ),
        ),
      ),
    );
  }

  Widget _content(_FoundResult result) {
    final locations = {
      for (final discovery in result.discoveries) discovery.wallId: discovery,
    };
    final mappedWalls = result.walls
        .where((wall) => wall.id.isNotEmpty && locations.containsKey(wall.id))
        .toList(growable: false);

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 50, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Transform.rotate(
            angle: -.012,
            child: Image.asset(
              UiAssets.wallsFoundHeader,
              width: 330,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            '${result.walls.length} WALL${result.walls.length == 1 ? '' : 'S'} FOUND  ·  ${mappedWalls.length} MAPPED',
            style: TextStyle(
              color: SaidHereTheme.ink.withValues(alpha: .58),
              fontSize: 10,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 14),
          _ViewSwitch(
            showMap: _showMap,
            onChanged: (value) => setState(() => _showMap = value),
          ),
          if (result.fromCache) ...[
            const SizedBox(height: 10),
            const _IndustrialNotice(
              icon: Icons.cloud_off_outlined,
              text: 'SAVED HISTORY · PULL DOWN TO RECONNECT',
            ),
          ],
          const SizedBox(height: 12),
          Expanded(
            child: result.walls.isEmpty
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        "YOU HAVEN'T FOUND A WALL YET.\n\nTAP A PHYSICAL WALL WHEN YOU SEE ONE.",
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: SaidHereTheme.ink,
                          fontSize: 17,
                          height: 1.45,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  )
                : _showMap
                    ? _FoundMap(
                        walls: mappedWalls,
                        locations: locations,
                        marker: _plaqueMarker,
                        onOpenWall: (wall) => context.push('/w/${wall.slug}'),
                      )
                    : RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView.builder(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(2, 5, 2, 25),
                          itemCount: result.walls.length,
                          itemBuilder: (context, index) {
                            final wall = result.walls[index];
                            final discovery = locations[wall.id];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 16),
                              child: _WallStencil(
                                wall: wall,
                                discovery: discovery,
                                index: index,
                                onTap: () => context.push('/w/${wall.slug}'),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _ViewSwitch extends StatelessWidget {
  const _ViewSwitch({required this.showMap, required this.onChanged});
  final bool showMap;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 42,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFE8DCC8).withValues(alpha: .92),
        border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .3)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Expanded(child: _button('MAP', Icons.public, showMap, () => onChanged(true))),
          Expanded(child: _button('LIST', Icons.list_alt, !showMap, () => onChanged(false))),
        ],
      ),
    );
  }

  Widget _button(String label, IconData icon, bool selected, VoidCallback onTap) {
    return Material(
      color: selected ? SaidHereTheme.ink : Colors.transparent,
      borderRadius: BorderRadius.circular(7),
      child: InkWell(
        borderRadius: BorderRadius.circular(7),
        onTap: onTap,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 17, color: selected ? SaidHereTheme.paper : SaidHereTheme.ink),
            const SizedBox(width: 7),
            Text(
              label,
              style: TextStyle(
                color: selected ? SaidHereTheme.paper : SaidHereTheme.ink,
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FoundMap extends StatefulWidget {
  const _FoundMap({
    required this.walls,
    required this.locations,
    required this.marker,
    required this.onOpenWall,
  });

  final List<Wall> walls;
  final Map<String, WallDiscovery> locations;
  final BitmapDescriptor? marker;
  final ValueChanged<Wall> onOpenWall;

  @override
  State<_FoundMap> createState() => _FoundMapState();
}

class _FoundMapState extends State<_FoundMap> {
  GoogleMapController? _controller;

  @override
  void didUpdateWidget(covariant _FoundMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.walls.length != widget.walls.length && _controller != null) {
      _fit(_controller!);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.hasGoogleMaps) {
      return _MapNotice(
        icon: Icons.map_outlined,
        title: 'MAP READY TO ENABLE',
        text: 'The discovery map is built, but this app build does not yet contain the Google Maps API key.',
      );
    }
    if (widget.walls.isEmpty) {
      return const _MapNotice(
        icon: Icons.location_off_outlined,
        title: 'NO MAPPED WALLS YET',
        text: 'Future scans can save where you found a Wall. Walls still work normally if location permission is off.',
      );
    }

    final markers = widget.walls.map((wall) {
      final discovery = widget.locations[wall.id]!;
      return Marker(
        markerId: MarkerId(wall.id),
        position: LatLng(discovery.latitude, discovery.longitude),
        icon: widget.marker ?? BitmapDescriptor.defaultMarker,
        anchor: const Offset(.5, .5),
        infoWindow: InfoWindow(
          title: wall.displayName,
          snippet: wall.locationHint.isNotEmpty
              ? wall.locationHint
              : 'Found ${DateFormat('d MMM yyyy').format(discovery.scannedAt)}',
          onTap: () => widget.onOpenWall(wall),
        ),
        onTap: () {},
      );
    }).toSet();

    final first = widget.locations[widget.walls.first.id]!;
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Stack(
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(
              target: LatLng(first.latitude, first.longitude),
              zoom: widget.walls.length == 1 ? 15 : 2.5,
            ),
            markers: markers,
            myLocationButtonEnabled: false,
            myLocationEnabled: false,
            compassEnabled: true,
            mapToolbarEnabled: false,
            zoomControlsEnabled: false,
            buildingsEnabled: true,
            onMapCreated: (controller) {
              _controller = controller;
              _fit(controller);
            },
          ),
          Positioned(
            right: 12,
            bottom: 12,
            child: FloatingActionButton.small(
              heroTag: 'fit-found-walls',
              backgroundColor: const Color(0xFFF3E8D6),
              foregroundColor: SaidHereTheme.ink,
              onPressed: () {
                final controller = _controller;
                if (controller != null) _fit(controller);
              },
              child: const Icon(Icons.center_focus_strong),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _fit(GoogleMapController controller) async {
    if (widget.walls.isEmpty) return;
    if (widget.walls.length == 1) {
      final d = widget.locations[widget.walls.first.id]!;
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(d.latitude, d.longitude), 15),
      );
      return;
    }

    final points = widget.walls
        .map((wall) => widget.locations[wall.id]!)
        .toList(growable: false);
    var minLat = points.first.latitude;
    var maxLat = points.first.latitude;
    var minLng = points.first.longitude;
    var maxLng = points.first.longitude;
    for (final point in points.skip(1)) {
      if (point.latitude < minLat) minLat = point.latitude;
      if (point.latitude > maxLat) maxLat = point.latitude;
      if (point.longitude < minLng) minLng = point.longitude;
      if (point.longitude > maxLng) maxLng = point.longitude;
    }
    await Future<void>.delayed(const Duration(milliseconds: 220));
    try {
      await controller.animateCamera(
        CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(minLat, minLng),
            northeast: LatLng(maxLat, maxLng),
          ),
          56,
        ),
      );
    } catch (_) {}
  }
}

class _MapNotice extends StatelessWidget {
  const _MapNotice({required this.icon, required this.title, required this.text});
  final IconData icon;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFFE8DCC8).withValues(alpha: .94),
        border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .35)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 44, color: SaidHereTheme.ink),
              const SizedBox(height: 14),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w900, letterSpacing: .8)),
              const SizedBox(height: 8),
              Text(text, textAlign: TextAlign.center, style: const TextStyle(height: 1.45, color: Color(0xFF655D52))),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavDisc extends StatelessWidget {
  const _NavDisc({required this.icon, required this.onPressed});
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Material(
        color: SaidHereTheme.ink.withValues(alpha: .80),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 38,
            height: 38,
            child: Icon(icon, color: SaidHereTheme.paper, size: 22),
          ),
        ),
      ),
    );
  }
}

class _IndustrialNotice extends StatelessWidget {
  const _IndustrialNotice({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: SaidHereTheme.ink.withValues(alpha: .86),
        border: Border.all(color: const Color(0xFF4D463D), width: 1.2),
      ),
      child: Row(
        children: [
          Icon(icon, color: SaidHereTheme.paper, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: SaidHereTheme.paper,
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: .5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WallStencil extends StatelessWidget {
  const _WallStencil({
    required this.wall,
    required this.discovery,
    required this.index,
    required this.onTap,
  });

  final Wall wall;
  final WallDiscovery? discovery;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final visited = wall.lastVisitedAt;
    final marker = index % 4 == 3 ? const Color(0xFF6F332D) : SaidHereTheme.ink;
    return Material(
      color: const Color(0x33F8F0E2),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
          child: Row(
            children: [
              Container(width: 4, height: 68, color: marker.withValues(alpha: .72)),
              const SizedBox(width: 13),
              Icon(
                discovery == null ? Icons.location_off_outlined : Icons.location_on_outlined,
                color: marker.withValues(alpha: .75),
                size: 24,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      wall.displayName.toUpperCase(),
                      style: TextStyle(
                        color: marker.withValues(alpha: .92),
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (wall.locationHint.isNotEmpty)
                      Text(
                        wall.locationHint.toUpperCase(),
                        style: TextStyle(color: marker.withValues(alpha: .58), fontSize: 10, fontWeight: FontWeight.w800),
                      ),
                    const SizedBox(height: 6),
                    Text(
                      discovery != null
                          ? 'FOUND ${DateFormat('d MMM yyyy').format(discovery!.scannedAt).toUpperCase()} · ${discovery!.scanCount} SCAN${discovery!.scanCount == 1 ? '' : 'S'}'
                          : visited != null
                              ? 'FOUND ${DateFormat('d MMM yyyy · HH:mm').format(visited).toUpperCase()} · LOCATION NOT SAVED'
                              : 'LOCATION NOT SAVED',
                      style: TextStyle(color: marker.withValues(alpha: .45), fontSize: 9, fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
              Icon(Icons.arrow_forward, color: marker.withValues(alpha: .65), size: 21),
            ],
          ),
        ),
      ),
    );
  }
}

class _FoundResult {
  const _FoundResult(
    this.walls, {
    this.discoveries = const [],
    this.fromCache = false,
    this.warning,
  });
  final List<Wall> walls;
  final List<WallDiscovery> discoveries;
  final bool fromCache;
  final String? warning;
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('TRY AGAIN'),
            ),
          ],
        ),
      ),
    );
  }
}
