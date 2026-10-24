import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/local_history_service.dart';
import '../services/said_here_service.dart';
import '../theme/app_theme.dart';
import '../widgets/wall_background.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    required this.service,
    required this.localHistory,
    super.key,
  });

  final SaidHereService service;
  final LocalHistoryService localHistory;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _deleting = false;

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open that page.')),
      );
    }
  }

  Future<void> _deleteAnonymousData() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete anonymous app data?'),
        content: const Text(
          'This permanently deletes this anonymous identity, its discovered Wall history, scan locations, posts, replies, reports and blocks. Owner purchase accounts are separate and are not deleted here.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('CANCEL'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('DELETE DATA'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _deleting = true);
    try {
      await widget.service.deleteAnonymousData();
      await widget.localHistory.clear();
      if (!mounted) return;
      context.go('/');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Anonymous app data deleted.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _deleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not delete data. ${error.toString()}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('PRIVACY & SUPPORT'),
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
      ),
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          top: false,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 36),
            children: [
              _Card(
                title: 'HELP & PRIVACY',
                children: [
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.help_outline),
                    title: const Text('Support'),
                    subtitle: const Text('NFC, purchases, owner accounts and app help.'),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => _open('https://saidhere.app/support/'),
                  ),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.privacy_tip_outlined),
                    title: const Text('Privacy Policy'),
                    subtitle: const Text('How anonymous sessions, locations and purchases are handled.'),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => _open('https://saidhere.app/privacy/'),
                  ),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.mail_outline),
                    title: const Text('Contact The Wall'),
                    subtitle: const Text('orders@saidhere.app'),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => _open('mailto:orders@saidhere.app?subject=The%20Wall%20Support'),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _Card(
                title: 'YOUR DATA',
                children: [
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.delete_outline),
                    title: const Text('Delete anonymous app data'),
                    subtitle: const Text(
                      'Delete this anonymous identity and its Wall activity from the service.',
                    ),
                    trailing: _deleting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.arrow_forward),
                    onTap: _deleting ? null : _deleteAnonymousData,
                  ),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.manage_accounts_outlined),
                    title: const Text('Delete owner account'),
                    subtitle: const Text(
                      'For people who purchased a Wall. Sign in securely, then confirm account deletion.',
                    ),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => _open('https://saidhere.app/my-walls/account/delete'),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                'The Wall has no public profiles, usernames, followers or direct messages. Blocking and reporting are tied only to anonymous service sessions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: SaidHereTheme.ink.withValues(alpha: .68),
                  height: 1.45,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
      decoration: BoxDecoration(
        color: const Color(0xFFE9DDC9).withValues(alpha: .96),
        border: Border.all(color: const Color(0xFF8B8174)),
        boxShadow: const [
          BoxShadow(color: Color(0x33000000), offset: Offset(3, 4), blurRadius: 0),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 4),
          ...children,
        ],
      ),
    );
  }
}
