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
                    const SizedBox(height: 24),
                    if (result.fromCache) ...[
                      Transform.rotate(
                        angle: .007,
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFD5C28E).withValues(alpha: .94),
                            border: Border.all(
                              color: SaidHereTheme.ink.withValues(alpha: .28),
                            ),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x33000000),
                                offset: Offset(2, 3),
                                blurRadius: 2,
                              ),
                            ],
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.cloud_off_outlined),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'SHOWING SAVED HISTORY. PULL DOWN TO RECONNECT.',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 11,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (walls.isEmpty)
                      Center(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(10, 65, 10, 40),
                          child: _EmptyNote(),
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
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -.01,
      child: SizedBox(
        width: 330,
        child: Stack(
          children: [
            Positioned.fill(
              child: Image.asset(
                UiAssets.noteWhite,
                fit: BoxFit.fill,
                filterQuality: FilterQuality.high,
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(34, 36, 34, 34),
              child: Text(
                "YOU HAVEN'T FOUND A WALL YET.\n\nTap a physical THE WALL plaque when you see one.",
                textAlign: TextAlign.center,
                style: TextStyle(
                  height: 1.45,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WallLabel extends StatelessWidget {
  const _WallLabel({
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
    final variant = index % 5;
    final isBlack = variant == 3;
    final paperAsset = isBlack
        ? UiAssets.noteBlack
        : (variant == 1 || variant == 4
            ? UiAssets.noteBrown
            : UiAssets.noteWhite);
    final foreground = isBlack
        ? const Color(0xFFF1E8D8)
        : SaidHereTheme.ink;
    final angle = ((index % 5) - 2) * .006;

    return Transform.rotate(
      angle: angle,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: Image.asset(
                paperAsset,
                fit: BoxFit.fill,
                filterQuality: FilterQuality.high,
              ),
            ),
            if (paperAsset == UiAssets.noteBrown)
              Positioned(
                top: -7,
                left: 105,
                child: Transform.rotate(
                  angle: index.isEven ? -.04 : .035,
                  child: Image.asset(
                    UiAssets.tapeCreamSmall,
                    width: 92,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              ),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 132),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(28, 28, 24, 24),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: foreground.withValues(alpha: .62),
                          width: 1.5,
                        ),
                      ),
                      child: Icon(
                        index.isEven ? Icons.location_city : Icons.park_outlined,
                        color: foreground,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            wall.displayName.toUpperCase(),
                            style: TextStyle(
                              color: foreground,
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
                                color: foreground.withValues(alpha: .82),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                          if (visited != null) ...[
                            const SizedBox(height: 9),
                            Text(
                              'FOUND ${DateFormat('d MMM yyyy · HH:mm').format(visited).toUpperCase()}',
                              style: TextStyle(
                                color: foreground.withValues(alpha: .64),
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                letterSpacing: .2,
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
          ],
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
