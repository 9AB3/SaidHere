import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/ui_assets.dart';
import '../models/wall_post.dart';
import '../theme/app_theme.dart';

class PostCard extends StatelessWidget {
  const PostCard({
    required this.post,
    required this.onReport,
    this.onReply,
    this.depth = 0,
    super.key,
  });

  final WallPost post;
  final VoidCallback? onReply;
  final VoidCallback onReport;
  final int depth;

  @override
  Widget build(BuildContext context) {
    final seed = post.id.codeUnits.fold<int>(0, (a, b) => a + b);
    final rng = math.Random(seed);
    final variant = seed % 7;

    final String paperAsset;
    final Color foreground;
    final String? tapeAsset;

    if (variant == 4) {
      paperAsset = UiAssets.noteBlack;
      foreground = const Color(0xFFF2E8D7);
      tapeAsset = UiAssets.tapeCreamSmall;
    } else if (variant == 2 || variant == 5) {
      paperAsset = UiAssets.noteBrown;
      foreground = SaidHereTheme.ink;
      tapeAsset = variant == 5 ? UiAssets.tapeWhite : UiAssets.tapeCreamSmall;
    } else {
      paperAsset = UiAssets.noteWhite;
      foreground = SaidHereTheme.ink;
      tapeAsset = null;
    }

    final angle = (rng.nextDouble() - .5) * .035;
    final left = depth == 0 ? 8.0 : 30.0;

    return Padding(
      padding: EdgeInsets.fromLTRB(left, 9, 8, 9),
      child: Transform.rotate(
        angle: angle,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: Image.asset(
                paperAsset,
                fit: BoxFit.fill,
                filterQuality: FilterQuality.high,
              ),
            ),
            if (tapeAsset != null)
              Positioned(
                top: -8,
                left: 64 + (seed % 42).toDouble(),
                child: Transform.rotate(
                  angle: (rng.nextDouble() - .5) * .08,
                  child: Image.asset(
                    tapeAsset,
                    width: 82,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              ),
            GestureDetector(
              onLongPress: onReport,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 118),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(22, 24, 18, 17),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        post.body,
                        style: TextStyle(
                          color: foreground.withValues(alpha: .97),
                          fontSize: depth == 0 ? 17 : 15,
                          height: 1.34,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.15,
                        ),
                      ),
                      const SizedBox(height: 13),
                      Container(
                        height: 1,
                        color: foreground.withValues(alpha: .16),
                      ),
                      const SizedBox(height: 5),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              DateFormat('d MMM yyyy · HH:mm')
                                  .format(post.createdAt)
                                  .toUpperCase(),
                              style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w700,
                                letterSpacing: .3,
                                color: foreground.withValues(alpha: .60),
                              ),
                            ),
                          ),
                          if (depth == 0 && onReply != null)
                            TextButton(
                              onPressed: onReply,
                              style: TextButton.styleFrom(
                                foregroundColor: foreground.withValues(alpha: .78),
                                visualDensity: VisualDensity.compact,
                                padding: const EdgeInsets.symmetric(horizontal: 8),
                              ),
                              child: const Text('REPLY'),
                            ),
                          IconButton(
                            tooltip: 'Report',
                            onPressed: onReport,
                            icon: const Icon(Icons.more_horiz, size: 18),
                            color: foreground.withValues(alpha: .72),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
