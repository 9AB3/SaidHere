import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

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
    final colors = [
      SaidHereTheme.fadedRed.withValues(alpha: .13),
      SaidHereTheme.fadedBlue.withValues(alpha: .15),
      SaidHereTheme.fadedYellow.withValues(alpha: .18),
      Colors.white.withValues(alpha: .28),
    ];

    final angle = (rng.nextDouble() - .5) * .025;
    final left = depth == 0 ? 8.0 : 26.0;

    return Padding(
      padding: EdgeInsets.fromLTRB(left, 6, 8, 6),
      child: Transform.rotate(
        angle: angle,
        child: Material(
          color: colors[seed % colors.length],
          elevation: 0,
          borderRadius: BorderRadius.circular(4),
          child: InkWell(
            onLongPress: onReport,
            borderRadius: BorderRadius.circular(4),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    post.body,
                    style: TextStyle(
                      color: SaidHereTheme.ink.withValues(alpha: .92),
                      fontSize: depth == 0 ? 17 : 15,
                      height: 1.35,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      Text(
                        DateFormat('d MMM yyyy').format(post.createdAt),
                        style: TextStyle(
                          fontSize: 11,
                          color: SaidHereTheme.ink.withValues(alpha: .58),
                        ),
                      ),
                      const Spacer(),
                      if (depth == 0 && onReply != null)
                        TextButton.icon(
                          onPressed: onReply,
                          icon: const Icon(Icons.subdirectory_arrow_right, size: 16),
                          label: const Text('reply'),
                          style: TextButton.styleFrom(
                            foregroundColor: SaidHereTheme.ink.withValues(alpha: .68),
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                      IconButton(
                        tooltip: 'Report',
                        onPressed: onReport,
                        icon: const Icon(Icons.more_horiz, size: 18),
                        visualDensity: VisualDensity.compact,
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
}
