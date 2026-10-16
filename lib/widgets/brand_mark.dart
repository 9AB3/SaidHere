import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({this.compact = false, this.color = SaidHereTheme.ink, super.key});

  final bool compact;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'SAID',
          style: TextStyle(
            fontSize: compact ? 24 : 54,
            fontWeight: FontWeight.w900,
            height: .82,
            letterSpacing: compact ? 1 : 2,
            color: color,
          ),
        ),
        Transform.rotate(
          angle: -.035,
          child: Text(
            'HERE',
            style: TextStyle(
              fontSize: compact ? 24 : 54,
              fontWeight: FontWeight.w900,
              height: .88,
              letterSpacing: compact ? 1 : 2,
              color: color,
            ),
          ),
        ),
      ],
    );
  }
}
