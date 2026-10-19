import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class WallBackground extends StatelessWidget {
  const WallBackground({required this.child, this.heavy = false, super.key});

  final Widget child;
  final bool heavy;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: Color(0xFFC9BDA6))),
        Positioned.fill(
          child: IgnorePointer(
            child: CustomPaint(painter: _DoorPainter(heavy: heavy)),
          ),
        ),
        child,
      ],
    );
  }
}

class _DoorPainter extends CustomPainter {
  const _DoorPainter({required this.heavy});

  final bool heavy;

  @override
  void paint(Canvas canvas, Size size) {
    final rng = math.Random(41);

    // Uneven painted metal / old laminate surface.
    final wash = Paint()..style = PaintingStyle.fill;
    for (var i = 0; i < 34; i++) {
      final alpha = .014 + rng.nextDouble() * .022;
      wash.color = (i.isEven ? Colors.white : SaidHereTheme.ink)
          .withValues(alpha: alpha);
      final x = rng.nextDouble() * size.width;
      final y = rng.nextDouble() * size.height;
      final w = 35 + rng.nextDouble() * 170;
      final h = 12 + rng.nextDouble() * 95;
      canvas.drawOval(Rect.fromLTWH(x, y, w, h), wash);
    }

    // Old sticker / adhesive patches.
    final adhesive = Paint()
      ..color = const Color(0xFFEEE3CD).withValues(alpha: .22)
      ..style = PaintingStyle.fill;
    final patches = <Rect>[
      Rect.fromLTWH(size.width * .06, size.height * .13, size.width * .20, 34),
      Rect.fromLTWH(size.width * .70, size.height * .32, size.width * .21, 52),
      Rect.fromLTWH(size.width * .11, size.height * .72, size.width * .18, 48),
    ];
    for (final patch in patches) {
      canvas.save();
      canvas.rotate((rng.nextDouble() - .5) * .04);
      canvas.drawRect(patch, adhesive);
      canvas.restore();
    }

    // Scratches and scuffs.
    final scratch = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 1.1
      ..color = SaidHereTheme.ink.withValues(alpha: heavy ? .18 : .11);
    for (var i = 0; i < (heavy ? 28 : 17); i++) {
      final x = rng.nextDouble() * size.width;
      final y = rng.nextDouble() * size.height;
      final len = 10 + rng.nextDouble() * 65;
      final rise = (rng.nextDouble() - .5) * 24;
      canvas.drawLine(Offset(x, y), Offset(x + len, y + rise), scratch);
    }

    // Small marker-style doodles. Deliberately sparse so content stays readable.
    final marker = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = heavy ? 2.0 : 1.45
      ..strokeCap = StrokeCap.round
      ..color = SaidHereTheme.ink.withValues(alpha: heavy ? .28 : .18);

    void heart(Offset p, double s) {
      final path = Path()
        ..moveTo(p.dx, p.dy + s * .25)
        ..cubicTo(p.dx - s, p.dy - s * .45, p.dx - s, p.dy + s * .65,
            p.dx, p.dy + s)
        ..cubicTo(p.dx + s, p.dy + s * .65, p.dx + s, p.dy - s * .45,
            p.dx, p.dy + s * .25);
      canvas.drawPath(path, marker);
    }

    heart(Offset(size.width * .88, size.height * .18), 9);
    heart(Offset(size.width * .09, size.height * .61), 7);

    final smileCenter = Offset(size.width * .82, size.height * .76);
    canvas.drawCircle(smileCenter, 11, marker);
    canvas.drawCircle(smileCenter.translate(-4, -2), 1, marker);
    canvas.drawCircle(smileCenter.translate(4, -2), 1, marker);
    final smile = Path()
      ..moveTo(smileCenter.dx - 5, smileCenter.dy + 3)
      ..quadraticBezierTo(
          smileCenter.dx, smileCenter.dy + 8, smileCenter.dx + 5, smileCenter.dy + 3);
    canvas.drawPath(smile, marker);

    // A few short handwritten-looking marks, not a repeated brand logo.
    if (heavy) {
      final textStyle = TextStyle(
        color: SaidHereTheme.ink.withValues(alpha: .32),
        fontSize: 12,
        fontWeight: FontWeight.w700,
        fontFamily: 'monospace',
      );
      void note(String text, Offset p, double angle) {
        final painter = TextPainter(
          text: TextSpan(text: text, style: textStyle),
          textDirection: TextDirection.ltr,
        )..layout();
        canvas.save();
        canvas.translate(p.dx, p.dy);
        canvas.rotate(angle);
        painter.paint(canvas, Offset.zero);
        canvas.restore();
      }

      note('good people\nstill exist', Offset(size.width * .05, size.height * .09), -.08);
      note('better days\nahead', Offset(size.width * .72, size.height * .64), .06);
      note('be kind', Offset(size.width * .08, size.height * .88), -.04);
    }

    // Door edge and old screw/hinge hints.
    final edge = Paint()
      ..color = SaidHereTheme.ink.withValues(alpha: .14)
      ..strokeWidth = 2;
    canvas.drawLine(const Offset(18, 0), Offset(18, size.height), edge);

    final metal = Paint()..color = const Color(0xFF6D6457).withValues(alpha: .5);
    for (final y in [size.height * .18, size.height * .72]) {
      canvas.drawCircle(Offset(18, y), 7, metal);
      canvas.drawCircle(
        Offset(18, y),
        2.3,
        Paint()..color = SaidHereTheme.ink.withValues(alpha: .55),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _DoorPainter oldDelegate) => oldDelegate.heavy != heavy;
}
