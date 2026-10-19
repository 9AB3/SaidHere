import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

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
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const SizedBox.shrink(),
        actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: WallBackground(
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
                padding: const EdgeInsets.fromLTRB(22, 14, 22, 34),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Transform.rotate(
                      angle: -.018,
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(18, 12, 20, 12),
                        decoration: BoxDecoration(
                          color: SaidHereTheme.ink,
                          border: Border.all(color: const Color(0xFF554B40), width: 2),
                          boxShadow: const [
                            BoxShadow(color: Color(0x44000000), offset: Offset(3, 4), blurRadius: 0),
                          ],
                        ),
                        child: const Text(
                          "WALLS YOU'VE FOUND",
                          style: TextStyle(
                            color: SaidHereTheme.paper,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .2,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  if (result.fromCache) ...[
                    Transform.rotate(
                      angle: .007,
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFD5C28E),
                          border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .35)),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.cloud_off_outlined),
                            SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'SHOWING SAVED HISTORY. PULL DOWN TO RECONNECT.',
                                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],
                  if (walls.isEmpty)
                    const Padding(
                      padding: EdgeInsets.fromLTRB(20, 90, 20, 40),
                      child: Text(
                        "YOU HAVEN'T FOUND A WALL YET.\n\nTap a physical THE WALL plaque when you see one.",
                        textAlign: TextAlign.center,
                        style: TextStyle(height: 1.5, fontWeight: FontWeight.w900),
                      ),
                    )
                  else
                    ...List.generate(walls.length, (index) {
                      final wall = walls[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 18),
                        child: _WallLabel(
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
    );
  }
}

class _WallLabel extends StatelessWidget {
  const _WallLabel({required this.wall, required this.index, required this.onTap});

  final Wall wall;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final visited = wall.lastVisitedAt;
    final schemes = <({Color bg, Color fg, Color tape})>[
      (bg: const Color(0xFFE7DCC9), fg: SaidHereTheme.ink, tape: const Color(0x77C9B184)),
      (bg: const Color(0xFF1C1B18), fg: const Color(0xFFE9DFCC), tape: const Color(0x668F806C)),
      (bg: const Color(0xFF9D3D31), fg: const Color(0xFFF1E2CF), tape: const Color(0x668B755C)),
      (bg: const Color(0xFFC9B88F), fg: SaidHereTheme.ink, tape: const Color(0x668C7655)),
    ];
    final scheme = schemes[index % schemes.length];
    final angle = ((index % 5) - 2) * .006;

    return Transform.rotate(
      angle: angle,
      child: Material(
        color: scheme.bg,
        elevation: 5,
        shadowColor: Colors.black38,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: SaidHereTheme.ink.withValues(alpha: .32), width: 1.2),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                top: -2,
                left: 54,
                right: 54,
                child: Transform.rotate(
                  angle: index.isEven ? -.025 : .02,
                  child: Container(height: 18, color: scheme.tape),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 22, 16, 18),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        border: Border.all(color: scheme.fg.withValues(alpha: .7), width: 1.5),
                      ),
                      child: Icon(
                        index.isEven ? Icons.location_city : Icons.park_outlined,
                        color: scheme.fg,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            wall.displayName.toUpperCase(),
                            style: TextStyle(
                              color: scheme.fg,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.2,
                            ),
                          ),
                          if (wall.locationHint.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              wall.locationHint,
                              style: TextStyle(
                                color: scheme.fg.withValues(alpha: .82),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                          if (visited != null) ...[
                            const SizedBox(height: 9),
                            Text(
                              'FOUND ${DateFormat('d MMM yyyy · HH:mm').format(visited).toUpperCase()}',
                              style: TextStyle(
                                color: scheme.fg.withValues(alpha: .72),
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward, color: scheme.fg, size: 20),
                  ],
                ),
              ),
            ],
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
