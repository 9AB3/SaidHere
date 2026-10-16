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
        title: const Text("WALLS YOU'VE FOUND"),
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
            if (walls.isEmpty) {
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    SizedBox(height: 160),
                    Padding(
                      padding: EdgeInsets.all(30),
                      child: Text(
                        "YOU HAVEN'T FOUND A WALL YET.\n\nTap a THE WALL NFC plaque when you see one.",
                        textAlign: TextAlign.center,
                        style: TextStyle(height: 1.5, fontWeight: FontWeight.w900),
                      ),
                    ),
                  ],
                ),
              );
            }

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 30),
                itemCount: walls.length + (result.fromCache ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (result.fromCache && index == 0) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: SaidHereTheme.fadedYellow.withValues(alpha: .32),
                        border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .35)),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.cloud_off_outlined),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'SHOWING SAVED WALL HISTORY. PULL DOWN TO RECONNECT.',
                              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  final wallIndex = result.fromCache ? index - 1 : index;
                  final wall = walls[wallIndex];
                  final visited = wall.lastVisitedAt;
                  final angle = ((wallIndex % 3) - 1) * .007;
                  return Transform.rotate(
                    angle: angle,
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xE6D5C7B0),
                        border: Border.all(
                          color: SaidHereTheme.ink.withValues(alpha: .30),
                          width: 1.2,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x33000000),
                            offset: Offset(2, 3),
                            blurRadius: 0,
                          ),
                        ],
                      ),
                      child: ListTile(
                        onTap: () => context.push('/w/${wall.slug}'),
                        leading: Container(
                          width: 38,
                          height: 38,
                          alignment: Alignment.center,
                          color: SaidHereTheme.ink,
                          child: Text(
                            '${wallIndex + 1}',
                            style: const TextStyle(
                              color: SaidHereTheme.paper,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        title: Text(
                          wall.displayName.toUpperCase(),
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        subtitle: Text([
                          if (wall.locationHint.isNotEmpty) wall.locationHint,
                          if (visited != null)
                            'LAST VISITED ${DateFormat('d MMM yyyy').format(visited).toUpperCase()}',
                        ].join('\n')),
                        trailing: const Icon(Icons.arrow_forward),
                      ),
                    ),
                  );
                },
              ),
            );
          },
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
