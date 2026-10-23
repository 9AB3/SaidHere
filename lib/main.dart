import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'config/app_config.dart';
import 'screens/configuration_screen.dart';
import 'screens/discovered_walls_screen.dart';
import 'screens/first_scan_setup_screen.dart';
import 'screens/home_screen.dart';
import 'screens/tag_entry_screen.dart';
import 'screens/wall_screen.dart';
import 'services/local_history_service.dart';
import 'services/said_here_service.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SaidHereApp());
}

String? normalizeCustomSchemeLocation(Uri uri) {
  if (uri.scheme.toLowerCase() != 'saidhere') return null;

  final host = uri.host.toLowerCase();
  final segments = uri.pathSegments.where((segment) => segment.isNotEmpty).toList();
  String? path;

  if ((host == 't' || host == 'w') && segments.isNotEmpty) {
    path = '/$host/${segments.first}';
  } else if (host == 'found') {
    path = '/found';
  } else if (host.isEmpty && segments.isNotEmpty) {
    if ((segments.first == 't' || segments.first == 'w') && segments.length >= 2) {
      path = '/${segments.first}/${segments[1]}';
    } else if (segments.first == 'found') {
      path = '/found';
    }
  }

  if (path == null) return '/';
  if (uri.query.isEmpty) return path;
  return '$path?${uri.query}';
}

class SaidHereApp extends StatefulWidget {
  const SaidHereApp({super.key});

  @override
  State<SaidHereApp> createState() => _SaidHereAppState();
}

class _SaidHereAppState extends State<SaidHereApp> {
  GoRouter? _router;

  @override
  void initState() {
    super.initState();
    if (AppConfig.isConfigured) {
      final service = SaidHereService();
      final history = LocalHistoryService();

      _router = GoRouter(
        redirect: (_, state) => normalizeCustomSchemeLocation(state.uri),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
          GoRoute(
            path: '/t/:token',
            builder: (_, state) => TagEntryScreen(
              tagToken: state.pathParameters['token']!,
              service: service,
              localHistory: history,
            ),
          ),
          GoRoute(
            path: '/setup/:token',
            builder: (_, state) => FirstScanSetupScreen(
              tagToken: state.pathParameters['token']!,
              service: service,
              localHistory: history,
            ),
          ),
          GoRoute(
            path: '/w/:slug',
            builder: (_, state) => WallScreen(
              slug: state.pathParameters['slug']!,
              service: service,
              freshVisit: state.uri.queryParameters['fresh'] == '1',
            ),
          ),
          GoRoute(
            path: '/found',
            builder: (_, _) => DiscoveredWallsScreen(
              service: service,
              localHistory: history,
            ),
          ),
        ],
        errorBuilder: (_, state) => Scaffold(
          body: Center(child: Text('That page does not exist.\n${state.uri}')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.isConfigured) {
      return MaterialApp(
        title: 'The Wall',
        debugShowCheckedModeBanner: false,
        theme: SaidHereTheme.light,
        home: const ConfigurationScreen(),
      );
    }

    return MaterialApp.router(
      title: 'The Wall',
      debugShowCheckedModeBanner: false,
      theme: SaidHereTheme.light,
      routerConfig: _router!,
    );
  }
}
