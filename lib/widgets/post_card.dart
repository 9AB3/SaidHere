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
    final schemes = <({Color bg, Color fg, Color tape})>[
      (bg: const Color(0xFFE9E1D2), fg: SaidHereTheme.ink, tape: const Color(0x77C5AA7B)),
      (bg: const Color(0xFFCDBB98), fg: SaidHereTheme.ink, tape: const Color(0x66796149)),
      (bg: const Color(0xFF1D1B18), fg: const Color(0xFFF0E6D5), tape: const Color(0x668C7C67)),
      (bg: const Color(0xFFDED0B8), fg: SaidHereTheme.ink, tape: const Color(0x778D7653)),
    ];
    final scheme = schemes[seed % schemes.length];

    final angle = (rng.nextDouble() - .5) * .035;
    final left = depth == 0 ? 8.0 : 28.0;

    return Padding(
      padding: EdgeInsets.fromLTRB(left, 8, 8, 8),
      child: Transform.rotate(
        angle: angle,
        child: Container(
          decoration: BoxDecoration(
            color: scheme.bg,
            border: Border.all(color: SaidHereTheme.ink.withValues(alpha: .24), width: 1.1),
            boxShadow: const [
              BoxShadow(color: Color(0x33000000), offset: Offset(2, 3), blurRadius: 0),
            ],
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              if (seed.isEven)
                Positioned(
                  top: -7,
                  left: 42,
                  right: 42,
                  child: Transform.rotate(
                    angle: (rng.nextDouble() - .5) * .05,
                    child: Container(height: 15, color: scheme.tape),
                  ),
                ),
              InkWell(
                onLongPress: onReport,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(17, 17, 12, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        post.body,
                        style: TextStyle(
                          color: scheme.fg.withValues(alpha: .97),
                          fontSize: depth == 0 ? 17 : 15,
                          height: 1.34,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.15,
                        ),
                      ),
                      const SizedBox(height: 11),
                      Container(height: 1, color: scheme.fg.withValues(alpha: .16)),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Text(
                            DateFormat('d MMM yyyy · HH:mm')
                                .format(post.createdAt)
                                .toUpperCase(),
                            style: TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                              color: scheme.fg.withValues(alpha: .60),
                            ),
                          ),
                          const Spacer(),
                          if (depth == 0 && onReply != null)
                            TextButton.icon(
                              onPressed: onReply,
                              icon: const Icon(Icons.subdirectory_arrow_right, size: 15),
                              label: const Text('REPLY'),
                              style: TextButton.styleFrom(
                                foregroundColor: scheme.fg.withValues(alpha: .76),
                                visualDensity: VisualDensity.compact,
                              ),
                            ),
                          IconButton(
                            tooltip: 'Report',
                            onPressed: onReport,
                            icon: const Icon(Icons.more_horiz, size: 18),
                            color: scheme.fg.withValues(alpha: .72),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
