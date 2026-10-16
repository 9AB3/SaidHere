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
                'TAP THE PLAQUE',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 10),
              Text(
                'Hold the top of your iPhone near The Wall plaque. When the NFC notification appears, tap it. That gives you 15 minutes to leave something on this wall.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  height: 1.45,
                  color: SaidHereTheme.ink.withValues(alpha: .78),
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('GOT IT'),
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
        heavy: true,
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 28, 22, 22),
                child: Column(
                  children: [
                    const Spacer(),
                    const BrandMark(),
                    const SizedBox(height: 18),
                    Transform.rotate(
                      angle: .012,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        color: const Color(0xD9D8CCB6),
                        child: const Text(
                          'EVERY PLACE HAS SOMETHING TO SAY.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .3,
                          ),
                        ),
                      ),
                    ),
                    const Spacer(),
                    Material(
                      color: SaidHereTheme.ink.withValues(alpha: .94),
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.all(Radius.circular(3)),
                        side: BorderSide(color: Color(0xFF514537), width: 2),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: () => _showPlaqueInstructions(context),
                        child: const Padding(
                          padding: EdgeInsets.all(17),
                          child: Row(
                            children: [
                              Icon(Icons.nfc, color: SaidHereTheme.paper, size: 32),
                              SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'HOW TO TAP THE WALL',
                                      style: TextStyle(
                                        color: SaidHereTheme.paper,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    SizedBox(height: 3),
                                    Text(
                                      'Tap the physical plaque. Read it. Leave your mark.',
                                      style: TextStyle(
                                        color: Color(0xFFD4C7B1),
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
                      label: const Text("WALLS YOU'VE FOUND"),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                        backgroundColor: SaidHereTheme.paper.withValues(alpha: .58),
                      ),
                    ),
                    if (AppConfig.demoTagToken.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      TextButton(
                        onPressed: () => context.push('/t/${AppConfig.demoTagToken}'),
                        child: const Text('OPEN DEMO WALL'),
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
