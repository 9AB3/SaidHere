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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

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

  List<WallPost> get _filteredPosts => _year == null
      ? _posts
      : _posts.where((p) => p.createdAt.year == _year).toList();

  @override
  Widget build(BuildContext context) {
    final wall = _wall;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: () => context.go('/found'),
          icon: const Icon(Icons.arrow_back),
        ),
        title: Column(
          children: [
            Text(
              wall?.displayName ?? 'THE WALL',
              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18),
            ),
            if ((wall?.locationHint ?? '').isNotEmpty)
              Text(
                wall!.locationHint,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                  color: SaidHereTheme.ink.withValues(alpha: .6),
                ),
              ),
          ],
        ),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: WallBackground(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text(_error!, textAlign: TextAlign.center),
                    ),
                  )
                : Column(
                    children: [
                      if (widget.freshVisit && wall?.canWriteNow == true)
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: SaidHereTheme.fadedBlue.withValues(alpha: .18),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Text(
                            'You are at this Wall. Writing is unlocked for 15 minutes.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                          ),
                        ),
                      if (_years.length > 1)
                        SizedBox(
                          height: 48,
                          child: ListView(
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            scrollDirection: Axis.horizontal,
                            children: [
                              _YearChip(
                                label: 'All',
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
                      Expanded(child: _buildPosts()),
                      SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                          child: FilledButton.icon(
                            onPressed: wall?.canWriteNow == true
                                ? () => _openComposer()
                                : () => _showLocationLimit(),
                            icon: Icon(
                              wall?.canWriteNow == true
                                  ? Icons.edit
                                  : Icons.lock_outline,
                            ),
                            label: Text(
                              wall?.canWriteNow == true
                                  ? 'Write on the wall…'
                                  : 'Visit this Wall to write',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }

  Widget _buildPosts() {
    final posts = _filteredPosts;
    if (posts.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(30),
          child: Text(
            'Nothing has been written here yet.\nBe the first person to leave something behind.',
            textAlign: TextAlign.center,
            style: TextStyle(height: 1.5, fontWeight: FontWeight.w700),
          ),
        ),
      );
    }

    final roots = posts.where((post) => post.parentId == null).toList();
    final repliesByParent = <String, List<WallPost>>{};
    for (final post in posts.where((post) => post.parentId != null)) {
      repliesByParent.putIfAbsent(post.parentId!, () => []).add(post);
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 20),
        itemCount: roots.length,
        itemBuilder: (context, index) {
          final root = roots[index];
          final replies = repliesByParent[root.id] ?? const <WallPost>[];
          return Column(
            children: [
              PostCard(
                post: root,
                onReply: () => _openComposer(parent: root),
                onReport: () => _report(root),
              ),
              for (final reply in replies)
                PostCard(
                  post: reply,
                  depth: 1,
                  onReply: () {},
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

    final controller = TextEditingController();
    final posted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: SaidHereTheme.paper,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            18,
            18,
            18,
            MediaQuery.viewInsetsOf(context).bottom + 18,
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
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
        );
      },
    );

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
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Report'),
          ),
        ],
      ),
    );

    if (shouldReport != true) return;
    await widget.service.reportPost(post.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Message reported. Thanks.')),
    );
    await _load();
  }

  Future<void> _showLocationLimit() async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.place_outlined),
        title: const Text('You need to be there'),
        content: const Text(
          'You can read a Wall you have found at any time. To write or reply, tap that Wall’s NFC plaque again in person.',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Got it'),
          ),
        ],
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
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
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
                parent == null ? 'Write on the wall' : 'Reply',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
            ),
            IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close),
            ),
          ],
        ),
        if (parent != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: SaidHereTheme.ink.withValues(alpha: .05),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              parent.body,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, height: 1.35),
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
          decoration: const InputDecoration(hintText: 'Leave something behind…'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _posting || widget.controller.text.trim().isEmpty
              ? null
              : () async {
                  setState(() => _posting = true);
                  try {
                    await widget.onPost();
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
              : Text(parent == null ? 'Post anonymously' : 'Post reply'),
        ),
      ],
    );
  }
}
