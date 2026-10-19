import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../models/wall.dart';
import '../models/wall_post.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/post_card.dart';
import '../widgets/wall_background.dart';

class WallScreen extends StatefulWidget {
  const WallScreen({
    required this.slug,
    required this.service,
    this.freshVisit = false,
    super.key,
  });

  final String slug;
  final SaidHereService service;
  final bool freshVisit;

  @override
  State<WallScreen> createState() => _WallScreenState();
}

class _WallScreenState extends State<WallScreen> {
  Wall? _wall;
  List<WallPost> _posts = const [];
  bool _loading = true;
  String? _error;
  int? _year;
  bool _newestFirst = true;
  Timer? _writeTimer;

  @override
  void initState() {
    super.initState();
    _load();
    _writeTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _wall?.writeAccessUntil != null) setState(() {});
    });
  }

  @override
  void dispose() {
    _writeTimer?.cancel();
    super.dispose();
  }

  void _goBack() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final wall = await widget.service.getWallBySlug(widget.slug);
      final posts = await widget.service.getPosts(wall.id);
      if (!mounted) return;
      setState(() {
        _wall = wall;
        _posts = posts;
        _loading = false;
        if (_year != null && !posts.any((p) => p.createdAt.year == _year)) {
          _year = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  List<int> get _years {
    final years = _posts.map((p) => p.createdAt.year).toSet().toList()..sort();
    return years.reversed.toList(growable: false);
  }

  List<WallPost> get _filteredPosts {
    if (_year == null) return _posts;
    final matching = _posts.where((p) => p.createdAt.year == _year).toList();
    final parentIds = matching
        .where((p) => p.parentId != null)
        .map((p) => p.parentId!)
        .toSet();
    final parents = _posts.where((p) => parentIds.contains(p.id));
    final byId = <String, WallPost>{for (final p in [...matching, ...parents]) p.id: p};
    return byId.values.toList();
  }

  String get _writeRemaining {
    final until = _wall?.writeAccessUntil;
    if (until == null) return '00:00';
    final remaining = until.difference(DateTime.now());
    if (remaining.isNegative) return '00:00';
    final minutes = remaining.inMinutes;
    final seconds = remaining.inSeconds.remainder(60);
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final wall = _wall;
    final canWrite = wall?.canWriteNow == true;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          onPressed: _goBack,
          icon: const Icon(Icons.arrow_back, size: 30),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              wall?.displayName ?? 'THE WALL',
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                letterSpacing: -.3,
              ),
            ),
            if ((wall?.locationHint ?? '').isNotEmpty)
              Text(
                wall!.locationHint.toUpperCase(),
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .6,
                  color: SaidHereTheme.ink.withValues(alpha: .58),
                ),
              ),
          ],
        ),
        actions: [
          PopupMenuButton<bool>(
            tooltip: 'Sort messages',
            initialValue: _newestFirst,
            onSelected: (value) => setState(() => _newestFirst = value),
            itemBuilder: (_) => const [
              PopupMenuItem(value: true, child: Text('Newest first')),
              PopupMenuItem(value: false, child: Text('Oldest first')),
            ],
            icon: const Icon(Icons.more_vert),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: WallBackground(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.only(top: kToolbarHeight - 4),
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _WallError(message: _error!, onRetry: _load)
                    : Column(
                        children: [
                          if (canWrite)
                            _WriteAccessStrip(remaining: _writeRemaining),
                          if (_years.length > 1)
                            SizedBox(
                              height: 44,
                              child: ListView(
                                padding: const EdgeInsets.symmetric(horizontal: 12),
                                scrollDirection: Axis.horizontal,
                                children: [
                                  _YearChip(
                                    label: 'ALL',
                                    selected: _year == null,
                                    onTap: () => setState(() => _year = null),
                                  ),
                                  ..._years.map(
                                    (year) => _YearChip(
                                      label: '$year',
                                      selected: _year == year,
                                      onTap: () => setState(() => _year = year),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          Expanded(child: _buildPosts(canWrite)),
                          SafeArea(
                            top: false,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                              child: _WriteBar(
                                canWrite: canWrite,
                                onPressed: canWrite
                                    ? () => _openComposer()
                                    : _showLocationLimit,
                              ),
                            ),
                          ),
                        ],
                      ),
          ),
        ),
      ),
    );
  }

  Widget _buildPosts(bool canWrite) {
    final posts = _filteredPosts;
    if (posts.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 38),
          child: Text(
            'NOTHING HAS BEEN WRITTEN HERE YET.\n\nBE THE FIRST TO LEAVE YOUR MARK.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: SaidHereTheme.ink,
              fontSize: 18,
              height: 1.45,
              fontWeight: FontWeight.w900,
              letterSpacing: .15,
            ),
          ),
        ),
      );
    }

    final roots = posts.where((post) => post.parentId == null).toList()
      ..sort((a, b) => _newestFirst
          ? b.createdAt.compareTo(a.createdAt)
          : a.createdAt.compareTo(b.createdAt));
    final repliesByParent = <String, List<WallPost>>{};
    for (final post in posts.where((post) => post.parentId != null)) {
      repliesByParent.putIfAbsent(post.parentId!, () => []).add(post);
    }
    for (final replies in repliesByParent.values) {
      replies.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(4, 8, 4, 20),
        itemCount: roots.length,
        itemBuilder: (context, index) {
          final root = roots[index];
          final replies = repliesByParent[root.id] ?? const <WallPost>[];
          return Column(
            children: [
              PostCard(
                post: root,
                onReply: canWrite ? () => _openComposer(parent: root) : null,
                onReport: () => _report(root),
              ),
              for (final reply in replies)
                PostCard(
                  post: reply,
                  depth: 1,
                  onReport: () => _report(reply),
                ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _openComposer({WallPost? parent}) async {
    final wall = _wall;
    if (wall == null) return;
    if (!wall.canWriteNow) {
      await _showLocationLimit();
      return;
    }

    final controller = TextEditingController();
    final posted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            14,
            0,
            14,
            MediaQuery.viewInsetsOf(sheetContext).bottom + 14,
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1815).withValues(alpha: .96),
              border: Border.all(color: const Color(0xFF514A40), width: 1.4),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x44000000),
                  offset: Offset(3, 4),
                  blurRadius: 2,
                ),
              ],
            ),
            child: Theme(
              data: Theme.of(sheetContext).copyWith(
                inputDecorationTheme: InputDecorationTheme(
                  filled: true,
                  fillColor: const Color(0xFFF0E6D5).withValues(alpha: .95),
                  border: const OutlineInputBorder(
                    borderRadius: BorderRadius.zero,
                    borderSide: BorderSide(color: Color(0xFF6A6258)),
                  ),
                  enabledBorder: const OutlineInputBorder(
                    borderRadius: BorderRadius.zero,
                    borderSide: BorderSide(color: Color(0xFF6A6258)),
                  ),
                  focusedBorder: const OutlineInputBorder(
                    borderRadius: BorderRadius.zero,
                    borderSide: BorderSide(color: Color(0xFF8E4E43), width: 2),
                  ),
                ),
              ),
              child: _Composer(
                controller: controller,
                parent: parent,
                onPost: () async {
                  final body = controller.text.trim();
                  if (body.isEmpty) return;
                  await widget.service.createPost(
                    wallId: wall.id,
                    body: body,
                    parentId: parent?.id,
                  );
                  if (sheetContext.mounted) Navigator.pop(sheetContext, true);
                },
              ),
            ),
          ),
        );
      },
    );
    controller.dispose();

    if (posted == true) await _load();
  }

  Future<void> _report(WallPost post) async {
    final shouldReport = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report this message?'),
        content: const Text(
          'Use this for abusive, threatening, hateful or otherwise inappropriate content.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('CANCEL'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('REPORT'),
          ),
        ],
      ),
    );

    if (shouldReport != true) return;
    try {
      await widget.service.reportPost(post.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message reported. Thanks.')),
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not report this message. ${error.toString()}')),
      );
    }
  }

  Future<void> _showLocationLimit() async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.place_outlined),
        title: const Text('YOU NEED TO BE THERE'),
        content: const Text(
          'You can read a Wall you have found at any time. To write or reply, tap that Wall’s NFC plaque again in person.',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('GOT IT'),
          ),
        ],
      ),
    );
  }
}

class _WriteAccessStrip extends StatelessWidget {
  const _WriteAccessStrip({required this.remaining});

  final String remaining;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -.003,
      child: Container(
        margin: const EdgeInsets.fromLTRB(18, 2, 18, 9),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: const Color(0xFF8E3A32).withValues(alpha: .94),
          border: Border.all(color: const Color(0xFF5F251F), width: 1.4),
          boxShadow: const [
            BoxShadow(color: Color(0x32000000), offset: Offset(2, 3), blurRadius: 1),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.edit_outlined, size: 16, color: Color(0xFFF2E5D2)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                'WRITING UNLOCKED · $remaining',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFF2E5D2),
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .7,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WriteBar extends StatelessWidget {
  const _WriteBar({required this.canWrite, required this.onPressed});

  final bool canWrite;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final background = canWrite
        ? const Color(0xFF8E3A32).withValues(alpha: .95)
        : SaidHereTheme.ink.withValues(alpha: .94);
    final label = canWrite
        ? 'LEAVE YOUR MARK'
        : 'LOCKED · TAP THE PLAQUE TO WRITE';

    return Transform.rotate(
      angle: -.002,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
            decoration: BoxDecoration(
              color: background,
              border: Border.all(color: const Color(0xFF4D463D), width: 1.4),
              boxShadow: const [
                BoxShadow(color: Color(0x33000000), offset: Offset(2, 3), blurRadius: 1),
              ],
            ),
            child: Row(
              children: [
                Icon(
                  canWrite ? Icons.edit_outlined : Icons.lock_outline,
                  color: SaidHereTheme.paper,
                  size: 19,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: SaidHereTheme.paper,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .55,
                    ),
                  ),
                ),
                const Icon(Icons.arrow_forward, color: SaidHereTheme.paper, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WallError extends StatelessWidget {
  const _WallError({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('TRY AGAIN'),
            ),
          ],
        ),
      ),
    );
  }
}

class _YearChip extends StatelessWidget {
  const _YearChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ActionChip(
        label: Text(label),
        onPressed: onTap,
        backgroundColor: selected
            ? SaidHereTheme.ink.withValues(alpha: .92)
            : const Color(0xFFE6DAC5).withValues(alpha: .42),
        side: BorderSide(color: SaidHereTheme.ink.withValues(alpha: .42)),
        labelStyle: TextStyle(
          color: selected ? SaidHereTheme.paper : SaidHereTheme.ink,
          fontWeight: FontWeight.w900,
          fontSize: 11,
        ),
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({required this.controller, required this.onPost, this.parent});
  final TextEditingController controller;
  final Future<void> Function() onPost;
  final WallPost? parent;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  bool _posting = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final parent = widget.parent;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                parent == null ? 'LEAVE YOUR MARK' : 'REPLY',
                style: const TextStyle(
                  color: SaidHereTheme.paper,
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .5,
                ),
              ),
            ),
            IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close, color: SaidHereTheme.paper),
            ),
          ],
        ),
        if (parent != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: SaidHereTheme.paper.withValues(alpha: .08),
              border: Border.all(color: SaidHereTheme.paper.withValues(alpha: .20)),
            ),
            child: Text(
              parent.body,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: SaidHereTheme.paper.withValues(alpha: .82),
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ),
        ],
        TextField(
          controller: widget.controller,
          autofocus: true,
          maxLength: 300,
          minLines: 4,
          maxLines: 7,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'Write something worth finding…',
          ),
          onChanged: (_) => setState(() => _error = null),
        ),
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(
            _error!,
            style: const TextStyle(color: Color(0xFFD27B6E), fontSize: 12),
          ),
        ],
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _posting || widget.controller.text.trim().isEmpty
              ? null
              : () async {
                  setState(() {
                    _posting = true;
                    _error = null;
                  });
                  try {
                    await widget.onPost();
                  } catch (error) {
                    if (mounted) setState(() => _error = error.toString());
                  } finally {
                    if (mounted) setState(() => _posting = false);
                  }
                },
          child: _posting
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(parent == null ? 'WRITE IT' : 'POST REPLY'),
        ),
      ],
    );
  }
}
