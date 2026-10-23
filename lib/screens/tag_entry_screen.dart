import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/discovery_location_service.dart';
import '../services/local_history_service.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class TagEntryScreen extends StatefulWidget {
  const TagEntryScreen({
    required this.tagToken,
    required this.service,
    required this.localHistory,
    super.key,
  });

  final String tagToken;
  final SaidHereService service;
  final LocalHistoryService localHistory;

  @override
  State<TagEntryScreen> createState() => _TagEntryScreenState();
}

class _TagEntryScreenState extends State<TagEntryScreen> {
  String? _error;
  bool _loading = false;

  bool get _wallInactive {
    final error = (_error ?? '').toLowerCase();
    return error.contains('wall is not active') ||
        error.contains('wall is inactive') ||
        error.contains('wall is offline');
  }

  @override
  void initState() {
    super.initState();
    _claim();
  }

  Future<void> _claim() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final wall = await widget.service.claimWallVisit(widget.tagToken);
      await widget.localHistory.rememberWall(
        slug: wall.slug,
        displayName: wall.displayName,
        locationHint: wall.locationHint,
      );

      // Location is deliberately optional and is recorded only after a genuine
      // NFC-backed Wall visit has succeeded. Do not delay opening the Wall while
      // GPS permission/fix/network work completes.
      unawaited(
        const DiscoveryLocationService().captureForWall(wallId: wall.id),
      );

      if (!mounted) return;
      context.go('/w/${wall.slug}?fresh=1');
    } on SaidHereException catch (error) {
      if (!mounted) return;
      if (error.setupRequired) {
        context.go('/setup/${widget.tagToken}');
        return;
      }
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Widget _wallPlaque() {
    return Transform.rotate(
      angle: -.006,
      child: Container(
        width: 205,
        padding: const EdgeInsets.fromLTRB(24, 21, 24, 20),
        decoration: BoxDecoration(
          color: const Color(0xFF151515),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: const Color(0xFF514A40),
            width: 3,
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x66000000),
              offset: Offset(4, 5),
              blurRadius: 2,
            ),
          ],
        ),
        child: const Column(
          children: [
            Text(
              'THE\nWALL',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(0xFFF1E8D8),
                fontSize: 38,
                height: .82,
                fontWeight: FontWeight.w900,
                letterSpacing: -2.3,
              ),
            ),
            SizedBox(height: 15),
            Icon(Icons.nfc, color: Color(0xFFF1E8D8), size: 40),
          ],
        ),
      ),
    );
  }

  Widget _actionButton({
    required VoidCallback onPressed,
    required IconData icon,
    required String label,
    bool primary = true,
  }) {
    final child = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 20),
        const SizedBox(width: 10),
        Text(
          label,
          style: const TextStyle(
            fontWeight: FontWeight.w900,
            letterSpacing: 1.1,
          ),
        ),
      ],
    );

    if (primary) {
      return SizedBox(
        width: double.infinity,
        height: 52,
        child: FilledButton(
          onPressed: onPressed,
          child: child,
        ),
      );
    }

    return SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: SaidHereTheme.ink,
          side: BorderSide(
            color: SaidHereTheme.ink.withValues(alpha: .45),
          ),
        ),
        child: child,
      ),
    );
  }

  Widget _statusCard() {
    if (_error == null) {
      return const Column(
        children: [
          SizedBox(
            width: 34,
            height: 34,
            child: CircularProgressIndicator(
              color: SaidHereTheme.ink,
              strokeWidth: 3,
            ),
          ),
          SizedBox(height: 16),
          Text(
            'OPENING THIS WALL…',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: SaidHereTheme.ink,
              fontWeight: FontWeight.w900,
              letterSpacing: .8,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Checking the Wall and opening your posting window.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF6C6357),
              height: 1.35,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    if (_wallInactive) {
      return Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF171411),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              'WALL OFFLINE',
              style: TextStyle(
                color: Color(0xFFF1E8D8),
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: 1.4,
              ),
            ),
          ),
          const SizedBox(height: 18),
          const Icon(
            Icons.power_settings_new_rounded,
            color: SaidHereTheme.ink,
            size: 42,
          ),
          const SizedBox(height: 12),
          const Text(
            'THIS WALL IS OFFLINE',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: SaidHereTheme.ink,
              fontSize: 20,
              fontWeight: FontWeight.w900,
              letterSpacing: .3,
            ),
          ),
          const SizedBox(height: 9),
          const Text(
            'The owner has temporarily taken this Wall offline. Your scan worked — there’s nothing wrong with your phone or the NFC tag.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF5F574D),
              height: 1.45,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 20),
          _actionButton(
            onPressed: () => context.go('/found'),
            icon: Icons.grid_view_rounded,
            label: 'WALLS I’VE FOUND',
          ),
          const SizedBox(height: 9),
          _actionButton(
            onPressed: _claim,
            icon: Icons.refresh_rounded,
            label: 'CHECK AGAIN',
            primary: false,
          ),
        ],
      );
    }

    return Column(
      children: [
        const Icon(
          Icons.error_outline_rounded,
          color: SaidHereTheme.ink,
          size: 40,
        ),
        const SizedBox(height: 12),
        const Text(
          'COULDN’T OPEN THIS WALL',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: SaidHereTheme.ink,
            fontSize: 18,
            fontWeight: FontWeight.w900,
            letterSpacing: .3,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          _error!,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Color(0xFF5F574D),
            height: 1.4,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 20),
        _actionButton(
          onPressed: _claim,
          icon: Icons.refresh_rounded,
          label: 'TRY AGAIN',
        ),
        const SizedBox(height: 9),
        _actionButton(
          onPressed: () => context.go('/found'),
          icon: Icons.grid_view_rounded,
          label: 'WALLS I’VE FOUND',
          primary: false,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(22, 28, 22, 34),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 430),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _wallPlaque(),
                    const SizedBox(height: 24),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(22, 22, 22, 21),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE9DECA),
                        border: Border.all(
                          color: SaidHereTheme.ink.withValues(alpha: .42),
                          width: 1.2,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x44000000),
                            offset: Offset(3, 4),
                            blurRadius: 0,
                          ),
                        ],
                      ),
                      child: _statusCard(),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
