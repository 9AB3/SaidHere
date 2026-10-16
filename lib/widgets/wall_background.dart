import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class WallBackground extends StatelessWidget {
  const WallBackground({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: SaidHereTheme.paper)),
        const Positioned.fill(child: CustomPaint(painter: _WallPainter())),
        child,
      ],
    );
  }
}

class _WallPainter extends CustomPainter {
  const _WallPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final grout = Paint()
      ..color = SaidHereTheme.ink.withValues(alpha: .035)
      ..strokeWidth = 1;

    const tile = 88.0;
    for (double y = 0; y < size.height; y += tile) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grout);
    }
    for (double x = 0; x < size.width; x += tile) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), grout);
    }

    final scribble = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 2;

    final marks = <({Offset p, Color c, double r})>[
      (p: Offset(size.width * .09, 140), c: SaidHereTheme.fadedRed, r: -.1),
      (p: Offset(size.width * .84, 210), c: SaidHereTheme.ink, r: .2),
      (p: Offset(size.width * .15, size.height * .72), c: SaidHereTheme.fadedBlue, r: .1),
      (p: Offset(size.width * .78, size.height * .82), c: SaidHereTheme.fadedRed, r: -.2),
    ];

    for (final mark in marks) {
      scribble.color = mark.c.withValues(alpha: .22);
      canvas.save();
      canvas.translate(mark.p.dx, mark.p.dy);
      canvas.rotate(mark.r);
      final path = Path()
        ..moveTo(-10, 0)
        ..quadraticBezierTo(-4, -14, 0, 0)
        ..quadraticBezierTo(6, -14, 10, 0)
        ..quadraticBezierTo(6, 7, 0, 15)
        ..quadraticBezierTo(-6, 7, -10, 0);
      canvas.drawPath(path, scribble);
      canvas.restore();
    }

    final rng = math.Random(4);
    final speck = Paint()..color = SaidHereTheme.ink.withValues(alpha: .025);
    for (var i = 0; i < 80; i++) {
      canvas.drawCircle(
        Offset(rng.nextDouble() * size.width, rng.nextDouble() * size.height),
        .5 + rng.nextDouble() * 1.2,
        speck,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
