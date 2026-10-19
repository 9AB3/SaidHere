import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/wall_post.dart';

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
    final isReply = depth > 0;
    final angle = (rng.nextDouble() - .5) * .030;

    // Mostly black marker, with occasional faded red / blue-grey marks.
    final markerColors = <Color>[
      const Color(0xFF171411),
      const Color(0xFF211D19),
      const Color(0xFF211D19),
      const Color(0xFF6F332D),
      const Color(0xFF242B2A),
      const Color(0xFF171411),
    ];
    final marker = markerColors[seed % markerColors.length];

    final markerFamilies = <String>[
      'Marker Felt',
      'Chalkboard SE',
      'Noteworthy',
    ];
    final markerFamily = markerFamilies[seed % markerFamilies.length];

    final messageSize = isReply
        ? 16.0 + (seed % 2)
        : 19.0 + ((seed % 3) * .45);

    return Padding(
      padding: EdgeInsets.fromLTRB(isReply ? 52 : 30, 15, 24, 15),
      child: Transform.rotate(
        angle: angle,
        alignment: Alignment.centerLeft,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            if (isReply)
              Positioned(
                left: -23,
                top: 4,
                bottom: 8,
                child: Transform.rotate(
                  angle: -.014,
                  child: Container(
                    width: 3.2,
                    decoration: BoxDecoration(
                      color: marker.withValues(alpha: .48),
                      borderRadius: BorderRadius.circular(5),
                    ),
                  ),
                ),
              ),
            GestureDetector(
              onLongPress: onReport,
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(2, 2, 2, 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Stack(
                      children: [
                        // Tiny offset duplicate gives the writing a little ink bleed
                        // without putting a card behind it.
                        Transform.translate(
                          offset: const Offset(.65, .55),
                          child: Text(
                            post.body,
                            style: TextStyle(
                              color: marker.withValues(alpha: .14),
                              fontFamily: markerFamily,
                              fontFamilyFallback: const [
                                'Marker Felt',
                                'Chalkboard SE',
                                'Noteworthy',
                                'sans-serif',
                              ],
                              fontSize: messageSize,
                              height: 1.20,
                              fontWeight: FontWeight.w700,
                              letterSpacing: isReply ? .05 : -.08,
                            ),
                          ),
                        ),
                        Text(
                          post.body,
                          style: TextStyle(
                            color: marker.withValues(alpha: .90),
                            fontFamily: markerFamily,
                            fontFamilyFallback: const [
                              'Marker Felt',
                              'Chalkboard SE',
                              'Noteworthy',
                              'sans-serif',
                            ],
                            fontSize: messageSize,
                            height: 1.20,
                            fontWeight: FontWeight.w700,
                            letterSpacing: isReply ? .05 : -.08,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            DateFormat('d MMM yyyy · HH:mm')
                                .format(post.createdAt)
                                .toUpperCase(),
                            style: TextStyle(
                              color: marker.withValues(alpha: .43),
                              fontSize: 9.2,
                              fontWeight: FontWeight.w800,
                              letterSpacing: .7,
                            ),
                          ),
                        ),
                        if (!isReply && onReply != null)
                          TextButton(
                            onPressed: onReply,
                            style: TextButton.styleFrom(
                              foregroundColor: marker.withValues(alpha: .62),
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              visualDensity: VisualDensity.compact,
                              minimumSize: const Size(0, 28),
                            ),
                            child: const Text(
                              'REPLY',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .7,
                              ),
                            ),
                          ),
                        IconButton(
                          tooltip: 'Report',
                          onPressed: onReport,
                          icon: const Icon(Icons.more_horiz, size: 19),
                          color: marker.withValues(alpha: .58),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    if (!isReply)
                      Transform.rotate(
                        angle: (rng.nextDouble() - .5) * .035,
                        child: Container(
                          width: 88 + (seed % 76).toDouble(),
                          height: 1.6,
                          margin: const EdgeInsets.only(top: 1),
                          color: marker.withValues(alpha: .17),
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
