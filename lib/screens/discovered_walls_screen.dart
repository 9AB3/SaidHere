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
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, size: 30),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const SizedBox.shrink(),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh, size: 28),
          ),
          const SizedBox(width: 6),
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
                    const SizedBox(height: 26),
                    if (result.fromCache) ...[
                      _IndustrialNotice(
                        icon: Icons.cloud_off_outlined,
                        text: 'SAVED HISTORY · PULL DOWN TO RECONNECT',
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (walls.isEmpty)
                      const Padding(
                        padding: EdgeInsets.fromLTRB(14, 70, 14, 40),
                        child: Text(
                          "YOU HAVEN'T FOUND A WALL YET.\n\nTAP A PHYSICAL THE WALL PLAQUE WHEN YOU SEE ONE.",
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
                          padding: const EdgeInsets.only(bottom: 16),
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
    final dark = index.isEven;
    final background = dark
        ? SaidHereTheme.ink.withValues(alpha: .88)
        : const Color(0xFFE9DDC8).withValues(alpha: .78);
    final foreground = dark ? SaidHereTheme.paper : SaidHereTheme.ink;

    return Transform.rotate(
      angle: angle,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 16, 15),
            decoration: BoxDecoration(
              color: background,
              border: Border.all(
                color: foreground.withValues(alpha: .36),
                width: 1.4,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x26000000),
                  offset: Offset(2, 3),
                  blurRadius: 1,
                ),
              ],
            ),
            child: Row(
              children: [
                Icon(Icons.location_on_outlined, color: foreground, size: 26),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        wall.displayName.toUpperCase(),
                        style: TextStyle(
                          color: foreground,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .3,
                        ),
                      ),
                      if (wall.locationHint.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          wall.locationHint.toUpperCase(),
                          style: TextStyle(
                            color: foreground.withValues(alpha: .72),
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .5,
                          ),
                        ),
                      ],
                      if (visited != null) ...[
                        const SizedBox(height: 7),
                        Text(
                          'FOUND ${DateFormat('d MMM yyyy · HH:mm').format(visited).toUpperCase()}',
                          style: TextStyle(
                            color: foreground.withValues(alpha: .54),
                            fontSize: 9.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .6,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Icon(Icons.arrow_forward, color: foreground, size: 22),
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
