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
    final angle = (rng.nextDouble() - .5) * .022;

    final colors = <Color>[
      const Color(0xFF1B1713),
      const Color(0xFF24201B),
      const Color(0xFF6E2E28),
      const Color(0xFF303A39),
    ];
    final marker = colors[seed % colors.length];
    final isReply = depth > 0;

    return Padding(
      padding: EdgeInsets.fromLTRB(isReply ? 46 : 22, 14, 18, 14),
      child: Transform.rotate(
        angle: angle,
        alignment: Alignment.centerLeft,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            if (isReply)
              Positioned(
                left: -19,
                top: 4,
                bottom: 4,
                child: Transform.rotate(
                  angle: -.018,
                  child: Container(
                    width: 3,
                    decoration: BoxDecoration(
                      color: marker.withValues(alpha: .55),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                ),
              ),
            Container(
              padding: const EdgeInsets.fromLTRB(8, 6, 4, 4),
              decoration: BoxDecoration(
                color: const Color(0xFFF1E8D8).withValues(alpha: .075),
                borderRadius: BorderRadius.circular(5),
              ),
              child: GestureDetector(
                onLongPress: onReport,
                behavior: HitTestBehavior.opaque,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      post.body,
                      style: TextStyle(
                        color: marker.withValues(alpha: .96),
                        fontSize: isReply ? 16 : 19,
                        height: 1.27,
                        fontWeight: FontWeight.w900,
                        letterSpacing: isReply ? -.20 : -.35,
                        shadows: [
                          Shadow(
                            color: marker.withValues(alpha: .14),
                            offset: const Offset(.7, .7),
                            blurRadius: .4,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            DateFormat('d MMM yyyy · HH:mm')
                                .format(post.createdAt)
                                .toUpperCase(),
                            style: TextStyle(
                              color: marker.withValues(alpha: .52),
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: .55,
                            ),
                          ),
                        ),
                        if (!isReply && onReply != null)
                          TextButton(
                            onPressed: onReply,
                            style: TextButton.styleFrom(
                              foregroundColor: marker.withValues(alpha: .70),
                              padding: const EdgeInsets.symmetric(horizontal: 7),
                              visualDensity: VisualDensity.compact,
                              minimumSize: const Size(0, 30),
                            ),
                            child: const Text(
                              'REPLY',
                              style: TextStyle(fontWeight: FontWeight.w900),
                            ),
                          ),
                        IconButton(
                          tooltip: 'Report',
                          onPressed: onReport,
                          icon: const Icon(Icons.more_horiz, size: 20),
                          color: marker.withValues(alpha: .68),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    if (!isReply)
                      Transform.rotate(
                        angle: (rng.nextDouble() - .5) * .025,
                        child: Container(
                          margin: const EdgeInsets.only(top: 2, right: 42),
                          height: 1.4,
                          color: marker.withValues(alpha: .18),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
