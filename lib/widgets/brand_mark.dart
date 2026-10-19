import 'package:flutter/material.dart';

import '../assets/app_assets.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({this.compact = false, this.color, super.key});

  final bool compact;
  final Color? color;

  static const artwork = AppAssets.plaque;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      artwork,
      width: compact ? 180 : 330,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      color: color,
      colorBlendMode: color == null ? null : BlendMode.modulate,
    );
  }
}
