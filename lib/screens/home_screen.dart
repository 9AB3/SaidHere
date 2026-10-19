import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config/app_config.dart';
import '../theme/app_theme.dart';
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
              padding: const EdgeInsets.fromLTRB(22, 28, 22, 22),
              decoration: BoxDecoration(
                color: const Color(0xFFE5D9C5),
                border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .34)),
                boxShadow: const [
                  BoxShadow(color: Color(0x44000000), offset: Offset(3, 4), blurRadius: 0),
                ],
              ),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    top: -38,
                    left: 42,
                    right: 42,
                    child: Transform.rotate(
                      angle: .02,
                      child: Container(height: 28, color: const Color(0x77C7AF82)),
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.nfc, size: 54, color: SaidHereTheme.ink),
                      const SizedBox(height: 10),
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
              constraints: const BoxConstraints(maxWidth: 540),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(30, 38, 26, 30),
                child: Column(
                  children: [
                    const SizedBox(height: 18),
                    _WallPlaque(onTap: () => _showPlaqueInstructions(context)),
                    const SizedBox(height: 32),
                    Transform.rotate(
                      angle: -.014,
                      child: const Text(
                        'Every place has\nsomething to say.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18,
                          height: 1.25,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.35,
                        ),
                      ),
                    ),
                    const SizedBox(height: 38),
                    Transform.rotate(
                      angle: .008,
                      child: Material(
                        color: SaidHereTheme.ink,
                        shape: const RoundedRectangleBorder(
                          side: BorderSide(color: Color(0xFF655A4C), width: 2),
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
                      const SizedBox(height: 16),
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

class _WallPlaque extends StatelessWidget {
  const _WallPlaque({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -.006,
      child: Material(
        color: const Color(0xFF151515),
        elevation: 8,
        shadowColor: Colors.black54,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: Color(0xFF3B3732), width: 3),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 286,
            child: Stack(
              children: [
                const Positioned(top: 12, left: 12, child: _Screw()),
                const Positioned(top: 12, right: 12, child: _Screw()),
                const Positioned(bottom: 12, left: 12, child: _Screw()),
                const Positioned(bottom: 12, right: 12, child: _Screw()),
                Padding(
                  padding: const EdgeInsets.fromLTRB(32, 30, 32, 28),
                  child: Column(
                    children: [
                      Transform.rotate(
                        angle: -.025,
                        child: const Text(
                          'THE\nWALL',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Color(0xFFF1E8D8),
                            fontSize: 52,
                            height: .80,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -3,
                          ),
                        ),
                      ),
                      const SizedBox(height: 22),
                      const Icon(Icons.nfc, color: Color(0xFFF1E8D8), size: 56),
                      const SizedBox(height: 6),
                      const Text(
                        'TAP HERE',
                        style: TextStyle(
                          color: Color(0xFFF1E8D8),
                          fontSize: 23,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.2,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Screw extends StatelessWidget {
  const _Screw();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 16,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: Color(0xFF746B5E),
        boxShadow: [BoxShadow(color: Colors.black87, offset: Offset(1, 1), blurRadius: 1)],
      ),
      child: const Center(
        child: SizedBox(width: 9, child: Divider(color: Color(0xFF282521), thickness: 1.5)),
      ),
    );
  }
}
