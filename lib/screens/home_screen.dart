import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config/app_config.dart';
import '../theme/app_theme.dart';
import '../widgets/brand_mark.dart';
import '../widgets/wall_background.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  void _showPlaqueInstructions(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: SaidHereTheme.paper,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 10, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.nfc, size: 52, color: SaidHereTheme.ink),
              const SizedBox(height: 14),
              const Text(
                'Tap a SaidHere plaque',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 10),
              Text(
                'Hold the top of your iPhone close to the SaidHere plaque. '
                'When the NFC notification appears, tap it to open that Wall.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  height: 1.45,
                  color: SaidHereTheme.ink.withValues(alpha: .72),
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(50),
                  backgroundColor: SaidHereTheme.ink,
                  foregroundColor: SaidHereTheme.paper,
                ),
                child: const Text('Got it'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: WallBackground(
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 36, 24, 24),
                child: Column(
                  children: [
                    const Spacer(),
                    const BrandMark(),
                    const SizedBox(height: 18),
                    Text(
                      'Real places. Real people.\nAnonymous thoughts.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 16,
                        height: 1.45,
                        fontWeight: FontWeight.w700,
                        color: SaidHereTheme.ink.withValues(alpha: .75),
                      ),
                    ),
                    const Spacer(),
                    Material(
                      color: SaidHereTheme.ink,
                      borderRadius: BorderRadius.circular(18),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: () => _showPlaqueInstructions(context),
                        child: const Padding(
                          padding: EdgeInsets.all(18),
                          child: Row(
                            children: [
                              Icon(Icons.nfc, color: SaidHereTheme.paper, size: 32),
                              SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Tap a SaidHere plaque',
                                      style: TextStyle(
                                        color: SaidHereTheme.paper,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    SizedBox(height: 3),
                                    Text(
                                      'That is how you discover a Wall.',
                                      style: TextStyle(
                                        color: Color(0xFFD7D0C1),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(Icons.chevron_right, color: SaidHereTheme.paper),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () => context.push('/found'),
                      icon: const Icon(Icons.history),
                      label: const Text("Walls you've found"),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                        foregroundColor: SaidHereTheme.ink,
                        side: BorderSide(
                          color: SaidHereTheme.ink.withValues(alpha: .25),
                        ),
                      ),
                    ),
                    if (AppConfig.demoTagToken.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      TextButton(
                        onPressed: () =>
                            context.push('/t/${AppConfig.demoTagToken}'),
                        child: const Text('Open demo Wall'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
