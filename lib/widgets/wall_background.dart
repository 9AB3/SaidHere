import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'brand_mark.dart';

class WallBackground extends StatelessWidget {
  const WallBackground({required this.child, this.heavy = false, super.key});

  final Widget child;
  final bool heavy;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: SaidHereTheme.paperDark)),
        Positioned.fill(
          child: Image.asset(
            BrandMark.artwork,
            fit: BoxFit.cover,
            alignment: Alignment.center,
            color: Colors.black.withValues(alpha: heavy ? .12 : .28),
            colorBlendMode: BlendMode.darken,
          ),
        ),
        Positioned.fill(
          child: ColoredBox(
            color: SaidHereTheme.paper.withValues(alpha: heavy ? .24 : .54),
          ),
        ),
        const Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: _ScratchPainter()))),
        child,
      ],
    );
  }
}

class _ScratchPainter extends CustomPainter {
  const _ScratchPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.1
      ..strokeCap = StrokeCap.round
      ..color = SaidHereTheme.ink.withValues(alpha: .14);

    final scratches = <List<Offset>>[
      [Offset(size.width * .04, size.height * .18), Offset(size.width * .30, size.height * .15)],
      [Offset(size.width * .76, size.height * .12), Offset(size.width * .93, size.height * .28)],
      [Offset(size.width * .10, size.height * .64), Offset(size.width * .33, size.height * .58)],
      [Offset(size.width * .67, size.height * .80), Offset(size.width * .96, size.height * .73)],
      [Offset(size.width * .14, size.height * .88), Offset(size.width * .23, size.height * .72)],
    ];

    for (final line in scratches) {
      canvas.drawLine(line.first, line.last, paint);
    }

    final thick = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4
      ..color = SaidHereTheme.rust.withValues(alpha: .11);
    canvas.drawLine(
      Offset(size.width * .02, size.height * .43),
      Offset(size.width * .27, size.height * .48),
      thick,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
