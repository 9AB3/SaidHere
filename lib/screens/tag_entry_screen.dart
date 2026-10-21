import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

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
  String? _setupUrl;
  bool _loading = false;
  bool _setupLaunchAttempted = false;

  @override
  void initState() {
    super.initState();
    _claim();
  }

  Future<void> _openSetup() async {
    final raw = _setupUrl;
    if (raw == null || raw.isEmpty) return;
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      setState(() {
        _error = 'Could not open first-time setup. Try again.';
      });
    }
  }

  Future<void> _claim() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
      _setupUrl = null;
    });
    try {
      final wall = await widget.service.claimWallVisit(widget.tagToken);
      await widget.localHistory.rememberWall(
        slug: wall.slug,
        displayName: wall.displayName,
        locationHint: wall.locationHint,
      );
      if (!mounted) return;
      context.go('/w/${wall.slug}?fresh=1');
    } on SaidHereException catch (error) {
      if (!mounted) return;
      if (error.setupRequired && error.setupUrl != null && error.setupUrl!.isNotEmpty) {
        setState(() {
          _loading = false;
          _setupUrl = error.setupUrl;
          _error = 'This is the first scan of this plaque. Set its Wall name and location to finish setup.';
        });
        if (!_setupLaunchAttempted) {
          _setupLaunchAttempted = true;
          await _openSetup();
        }
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

  @override
  Widget build(BuildContext context) {
    final isSetup = _setupUrl != null;
    return Scaffold(
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Transform.rotate(
                      angle: -.006,
                      child: Container(
                        width: 230,
                        padding: const EdgeInsets.fromLTRB(26, 24, 26, 22),
                        decoration: BoxDecoration(
                          color: const Color(0xFF151515),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFF514A40), width: 3),
                          boxShadow: const [
                            BoxShadow(color: Color(0x66000000), offset: Offset(4, 5), blurRadius: 2),
                          ],
                        ),
                        child: const Column(
                          children: [
                            Text(
                              'THE\nWALL',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Color(0xFFF1E8D8),
                                fontSize: 42,
                                height: .82,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -2.5,
                              ),
                            ),
                            SizedBox(height: 18),
                            Icon(Icons.nfc, color: Color(0xFFF1E8D8), size: 46),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                    Transform.rotate(
                      angle: .006,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
                        decoration: BoxDecoration(
                          color: const Color(0xFFE5D9C5),
                          border: Border.all(
                            color: SaidHereTheme.ink.withValues(alpha: .45),
                            width: 1.3,
                          ),
                          boxShadow: const [
                            BoxShadow(color: Color(0x44000000), offset: Offset(3, 4), blurRadius: 0),
                          ],
                        ),
                        child: _error == null
                            ? const Column(
                                children: [
                                  SizedBox(
                                    width: 38,
                                    height: 38,
                                    child: CircularProgressIndicator(
                                      color: SaidHereTheme.ink,
                                      strokeWidth: 3,
                                    ),
                                  ),
                                  SizedBox(height: 18),
                                  Text(
                                    'OPENING THIS WALL…',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: SaidHereTheme.ink,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: .3,
                                    ),
                                  ),
                                ],
                              )
                            : Column(
                                children: [
                                  Icon(
                                    isSetup ? Icons.tune : Icons.error_outline,
                                    color: SaidHereTheme.ink,
                                    size: 38,
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    isSetup ? 'SET UP YOUR WALL' : _error!,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: SaidHereTheme.ink,
                                      height: 1.4,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  if (isSetup) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      _error!,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: SaidHereTheme.ink,
                                        height: 1.4,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 18),
                                    FilledButton.icon(
                                      onPressed: _openSetup,
                                      icon: const Icon(Icons.open_in_browser),
                                      label: const Text('CONTINUE SETUP'),
                                    ),
                                    const SizedBox(height: 8),
                                    OutlinedButton.icon(
                                      onPressed: _claim,
                                      icon: const Icon(Icons.check_circle_outline),
                                      label: const Text("I'VE FINISHED SETUP"),
                                    ),
                                  ] else ...[
                                    const SizedBox(height: 18),
                                    FilledButton.icon(
                                      onPressed: _claim,
                                      icon: const Icon(Icons.refresh),
                                      label: const Text('TRY AGAIN'),
                                    ),
                                  ],
                                  const SizedBox(height: 8),
                                  OutlinedButton(
                                    onPressed: () => context.go('/'),
                                    child: const Text('GO HOME'),
                                  ),
                                ],
                              ),
                      ),
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
