import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/local_history_service.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/brand_mark.dart';

class TagEntryScreen extends StatefulWidget {
  const TagEntryScreen({
    required this.tagToken,
    required this.service,
    required this.localHistory,
    super.key,
  });

  final String tagToken;
  final SaidHereService service;
  final LocalHistoryService localHistory;

  @override
  State<TagEntryScreen> createState() => _TagEntryScreenState();
}

class _TagEntryScreenState extends State<TagEntryScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    _claim();
  }

  Future<void> _claim() async {
    try {
      final wall = await widget.service.claimWallVisit(widget.tagToken);
      await widget.localHistory.rememberWall(
        slug: wall.slug,
        displayName: wall.displayName,
        locationHint: wall.locationHint,
      );
      if (!mounted) return;
      context.go('/w/${wall.slug}?fresh=1');
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SaidHereTheme.ink,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const BrandMark(color: SaidHereTheme.paper),
                const SizedBox(height: 32),
                if (_error == null) ...[
                  const SizedBox(
                    width: 38,
                    height: 38,
                    child: CircularProgressIndicator(
                      color: SaidHereTheme.paper,
                      strokeWidth: 3,
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Getting the wall…',
                    style: TextStyle(
                      color: SaidHereTheme.paper,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ] else ...[
                  const Icon(
                    Icons.error_outline,
                    color: SaidHereTheme.paper,
                    size: 36,
                  ),
                  const SizedBox(height: 14),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: SaidHereTheme.paper,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 18),
                  OutlinedButton(
                    onPressed: () => context.go('/'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: SaidHereTheme.paper,
                      side: const BorderSide(color: SaidHereTheme.paper),
                    ),
                    child: const Text('Go home'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
