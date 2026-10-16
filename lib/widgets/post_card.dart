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
      const Color(0xFFCEC0A8),
      const Color(0xFFC5B59B),
      const Color(0xFFD5C7B0),
      const Color(0xFFBFAE95),
    ];

    final angle = (rng.nextDouble() - .5) * .045;
    final left = depth == 0 ? 6.0 : 24.0;

    return Padding(
      padding: EdgeInsets.fromLTRB(left, 7, 7, 7),
      child: Transform.rotate(
        angle: angle,
        child: Container(
          decoration: BoxDecoration(
            color: colors[seed % colors.length].withValues(alpha: .91),
            border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .26), width: 1.2),
            boxShadow: const [
              BoxShadow(color: Color(0x33000000), offset: Offset(2, 3), blurRadius: 0),
            ],
          ),
          child: InkWell(
            onLongPress: onReport,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    post.body,
                    style: TextStyle(
                      color: SaidHereTheme.ink.withValues(alpha: .96),
                      fontSize: depth == 0 ? 17 : 15,
                      height: 1.32,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.15,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(height: 1, color: SaidHereTheme.ink.withValues(alpha: .18)),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Text(
                        DateFormat('d MMM yyyy').format(post.createdAt).toUpperCase(),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: SaidHereTheme.ink.withValues(alpha: .6),
                        ),
                      ),
                      const Spacer(),
                      if (depth == 0 && onReply != null)
                        TextButton.icon(
                          onPressed: onReply,
                          icon: const Icon(Icons.subdirectory_arrow_right, size: 16),
                          label: const Text('REPLY'),
                          style: TextButton.styleFrom(
                            foregroundColor: SaidHereTheme.ink.withValues(alpha: .76),
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
