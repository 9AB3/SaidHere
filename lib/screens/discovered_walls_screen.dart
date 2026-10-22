import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../config/ui_assets.dart';
import '../models/wall.dart';
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
  late Future<_WallsResult> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_WallsResult> _load() async {
    try {
      return _WallsResult(await widget.service.getMyWalls(), fromCache: false);
    } catch (error) {
      final cached = await widget.localHistory.cachedWalls();
      if (cached.isNotEmpty) {
        return _WallsResult(cached, fromCache: true, warning: error.toString());
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
          child: FutureBuilder<_WallsResult>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return _ErrorState(message: snapshot.error.toString(), onRetry: _refresh);
              }
              final result = snapshot.data ?? const _WallsResult([]);
              final walls = result.walls;

              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(22, 58, 22, 34),
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Transform.rotate(
                        angle: -.012,
                        child: Image.asset(
                          UiAssets.wallsFoundHeader,
                          width: 360,
                          fit: BoxFit.contain,
                          filterQuality: FilterQuality.high,
                        ),
                      ),
                    ),
                    const SizedBox(height: 30),
                    if (result.fromCache) ...[
                      const _IndustrialNotice(
                        icon: Icons.cloud_off_outlined,
                        text: 'SAVED HISTORY · PULL DOWN TO RECONNECT',
                      ),
                      const SizedBox(height: 22),
                    ],
                    if (walls.isEmpty)
                      const Padding(
                        padding: EdgeInsets.fromLTRB(14, 70, 14, 40),
                        child: Text(
                          "YOU HAVEN'T FOUND A WALL YET.\n\nTAP A PHYSICAL WALL WHEN YOU SEE ONE.",
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: SaidHereTheme.ink,
                            fontSize: 17,
                            height: 1.45,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .2,
                          ),
                        ),
                      )
                    else
                      ...List.generate(walls.length, (index) {
                        final wall = walls[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 24),
                          child: _WallStencil(
                            wall: wall,
                            index: index,
                            onTap: () => context.push('/w/${wall.slug}'),
                          ),
                        );
                      }),
                  ],
                ),
              );
            },
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
    return Transform.rotate(
      angle: .004,
      child: Container(
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
      ),
    );
  }
}

class _WallStencil extends StatelessWidget {
  const _WallStencil({
    required this.wall,
    required this.index,
    required this.onTap,
  });

  final Wall wall;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final visited = wall.lastVisitedAt;
    final angle = ((index % 5) - 2) * .004;
    final marker = index % 4 == 3
        ? const Color(0xFF6F332D)
        : SaidHereTheme.ink;

    return Transform.rotate(
      angle: angle,
      alignment: Alignment.centerLeft,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 10, 4, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 4,
                  height: 76,
                  decoration: BoxDecoration(
                    color: marker.withValues(alpha: .72),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(width: 14),
                Icon(
                  Icons.location_on_outlined,
                  color: marker.withValues(alpha: .78),
                  size: 25,
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        wall.displayName.toUpperCase(),
                        style: TextStyle(
                          color: marker.withValues(alpha: .92),
                          fontFamily: 'Chalkboard SE',
                          fontFamilyFallback: const [
                            'Marker Felt',
                            'Noteworthy',
                            'sans-serif',
                          ],
                          fontSize: 19,
                          fontWeight: FontWeight.w700,
                          letterSpacing: .1,
                        ),
                      ),
                      if (wall.locationHint.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          wall.locationHint.toUpperCase(),
                          style: TextStyle(
                            color: marker.withValues(alpha: .62),
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .6,
                          ),
                        ),
                      ],
                      if (visited != null) ...[
                        const SizedBox(height: 7),
                        Text(
                          'FOUND ${DateFormat('d MMM yyyy · HH:mm').format(visited).toUpperCase()}',
                          style: TextStyle(
                            color: marker.withValues(alpha: .43),
                            fontSize: 9.2,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .7,
                          ),
                        ),
                      ],
                      const SizedBox(height: 9),
                      Container(
                        width: 145 + (index % 4) * 26,
                        height: 1.5,
                        color: marker.withValues(alpha: .16),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.arrow_forward,
                  color: marker.withValues(alpha: .72),
                  size: 22,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WallsResult {
  const _WallsResult(this.walls, {this.fromCache = false, this.warning});
  final List<Wall> walls;
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
