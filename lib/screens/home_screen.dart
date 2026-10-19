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
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
          child: Transform.rotate(
            angle: -.008,
            child: Container(
              padding: const EdgeInsets.fromLTRB(22, 30, 22, 22),
              decoration: BoxDecoration(
                color: const Color(0xFFF0E6D6),
                border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .34)),
                boxShadow: const [
                  BoxShadow(color: Color(0x55000000), offset: Offset(4, 5), blurRadius: 0),
                ],
              ),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    top: -40,
                    left: 42,
                    right: 42,
                    child: Transform.rotate(
                      angle: .02,
                      child: Container(height: 30, color: const Color(0x88C5AD7D)),
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.nfc, size: 52, color: SaidHereTheme.ink),
                      const SizedBox(height: 12),
                      const Text(
                        'TAP THE PLAQUE',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 23, fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Hold the top of your iPhone near the physical plaque. Tap the NFC notification when it appears. That unlocks writing on that Wall for 15 minutes.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          height: 1.45,
                          color: SaidHereTheme.ink.withValues(alpha: .80),
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
                ],
              ),
            ),
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
              constraints: const BoxConstraints(maxWidth: 520),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(28, 48, 28, 36),
                child: Column(
                  children: [
                    const SizedBox(height: 28),
                    Semantics(
                      button: true,
                      label: 'How to tap The Wall plaque',
                      child: GestureDetector(
                        onTap: () => _showPlaqueInstructions(context),
                        child: const BrandMark(),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Transform.rotate(
                      angle: -.010,
                      child: const Text(
                        'Every place has\nsomething to say.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 20,
                          height: 1.18,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.55,
                        ),
                      ),
                    ),
                    const SizedBox(height: 38),
                    Transform.rotate(
                      angle: .008,
                      child: Material(
                        color: SaidHereTheme.ink,
                        elevation: 5,
                        shadowColor: Colors.black54,
                        shape: const RoundedRectangleBorder(
                          side: BorderSide(color: Color(0xFF5E5549), width: 2),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => context.push('/found'),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.map_outlined, color: SaidHereTheme.paper, size: 25),
                                SizedBox(width: 13),
                                Text(
                                  "WALLS YOU'VE FOUND",
                                  style: TextStyle(
                                    color: SaidHereTheme.paper,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: .2,
                                  ),
                                ),
                                SizedBox(width: 10),
                                Icon(Icons.arrow_forward, color: SaidHereTheme.paper, size: 20),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (AppConfig.demoTagToken.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      TextButton(
                        onPressed: () => context.push('/t/${AppConfig.demoTagToken}'),
                        child: const Text('OPEN DEMO WALL'),
                      ),
                    ],
                    const SizedBox(height: 34),
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
