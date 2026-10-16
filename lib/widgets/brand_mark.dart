import 'package:flutter/material.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({this.compact = false, this.color, super.key});

  final bool compact;
  final Color? color;

  static const artwork = 'lib/theme/Grungy Graffiti Wall_ The Wall.png';

  @override
  Widget build(BuildContext context) {
    final height = compact ? 72.0 : 190.0;
    return Transform.rotate(
      angle: compact ? -.012 : -.018,
      child: Container(
        constraints: BoxConstraints(maxWidth: compact ? 190 : 390),
        height: height,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xAA17130F), width: compact ? 1 : 2),
          boxShadow: const [
            BoxShadow(color: Color(0x44000000), offset: Offset(3, 4), blurRadius: 0),
          ],
        ),
        clipBehavior: Clip.hardEdge,
        child: Image.asset(
          artwork,
          fit: BoxFit.cover,
          alignment: Alignment.center,
          color: color,
          colorBlendMode: color == null ? null : BlendMode.modulate,
        ),
      ),
    );
  }
}
