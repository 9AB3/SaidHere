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
        title: const Text("Walls you've found"),
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
                        "You haven't found a Wall yet.\n\nTap a SaidHere NFC plaque when you see one.",
                        textAlign: TextAlign.center,
                        style: TextStyle(height: 1.5, fontWeight: FontWeight.w700),
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
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  if (result.fromCache && index == 0) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: SaidHereTheme.fadedYellow.withValues(alpha: .22),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.cloud_off_outlined),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Showing saved Wall history. Pull down to reconnect.',
                              style: TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  final wallIndex = result.fromCache ? index - 1 : index;
                  final wall = walls[wallIndex];
                  final visited = wall.lastVisitedAt;
                  return Card(
                    color: Colors.white.withValues(alpha: .32),
                    elevation: 0,
                    child: ListTile(
                      onTap: () => context.push('/w/${wall.slug}'),
                      leading: CircleAvatar(
                        backgroundColor: SaidHereTheme.ink,
                        foregroundColor: SaidHereTheme.paper,
                        child: Text('${wallIndex + 1}'),
                      ),
                      title: Text(
                        wall.displayName,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      subtitle: Text([
                        if (wall.locationHint.isNotEmpty) wall.locationHint,
                        if (visited != null)
                          'Last visited ${DateFormat('d MMM yyyy').format(visited)}',
                      ].join('\n')),
                      trailing: const Icon(Icons.chevron_right),
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
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}
