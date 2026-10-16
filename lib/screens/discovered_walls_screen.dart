import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/wall.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class DiscoveredWallsScreen extends StatefulWidget {
  const DiscoveredWallsScreen({required this.service, super.key});

  final SaidHereService service;

  @override
  State<DiscoveredWallsScreen> createState() => _DiscoveredWallsScreenState();
}

class _DiscoveredWallsScreenState extends State<DiscoveredWallsScreen> {
  late Future<List<Wall>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.service.getMyWalls();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Walls you've found")),
      body: WallBackground(
        child: FutureBuilder<List<Wall>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _ErrorState(message: snapshot.error.toString());
            }
            final walls = snapshot.data ?? [];
            if (walls.isEmpty) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(30),
                  child: Text(
                    "You haven't found a Wall yet.\n\nTap a SaidHere NFC plaque when you see one.",
                    textAlign: TextAlign.center,
                    style: TextStyle(height: 1.5, fontWeight: FontWeight.w700),
                  ),
                ),
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 30),
              itemCount: walls.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final wall = walls[index];
                final visited = wall.lastVisitedAt;
                return Card(
                  color: Colors.white.withValues(alpha: .32),
                  elevation: 0,
                  child: ListTile(
                    onTap: () => context.go('/w/${wall.slug}'),
                    leading: CircleAvatar(
                      backgroundColor: SaidHereTheme.ink,
                      foregroundColor: SaidHereTheme.paper,
                      child: Text('${index + 1}'),
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
            );
          },
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(30),
        child: Text(message, textAlign: TextAlign.center),
      ),
    );
  }
}
