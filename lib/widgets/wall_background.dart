import 'package:flutter/material.dart';

import '../assets/app_assets.dart';
import '../theme/app_theme.dart';

class WallBackground extends StatelessWidget {
  const WallBackground({required this.child, this.heavy = false, super.key});

  final Widget child;
  final bool heavy;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        const ColoredBox(color: SaidHereTheme.paperDark),
        Image.asset(
          AppAssets.stallDoor,
          fit: BoxFit.cover,
          alignment: Alignment.topCenter,
          filterQuality: FilterQuality.high,
        ),
        // Keep the real photo visible. Content screens get only a very light wash
        // so cards and text remain readable without returning to the flat beige look.
        ColoredBox(
          color: SaidHereTheme.paper.withValues(alpha: heavy ? .02 : .08),
        ),
        child,
      ],
    );
  }
}
